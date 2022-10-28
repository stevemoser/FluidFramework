/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

import { assert } from "@fluidframework/common-utils";
import {
    Value,
    Anchor,
    FieldKey,
    symbolIsFieldKey,
    IEditableForest,
    TreeNavigationResult,
    ITreeSubscriptionCursor,
    ITreeSubscriptionCursorState,
    FieldSchema,
    LocalFieldKey,
    TreeSchemaIdentifier,
    NamedTreeSchema,
    ValueSchema,
    lookupTreeSchema,
    mapCursorField,
    mapCursorFields,
    CursorLocationType,
    FieldAnchor,
} from "../../core";
import { brand } from "../../util";
import { FieldKind, Multiplicity } from "../modular-schema";
import {
    AdaptingProxyHandler,
    adaptWithProxy,
    getFieldKind,
    getFieldSchema,
    getPrimaryField,
    isPrimitive,
    isPrimitiveValue,
    PrimitiveValue,
    keyIsValidIndex,
    getOwnArrayKeys,
} from "./utilities";
import { EditableTreeContext, ProxyContext } from "./editableTreeContext";

/**
 * A symbol for extracting target from editable-tree proxies.
 * Useful for debugging and testing, but not part of the public API.
 */
export const proxyTargetSymbol: unique symbol = Symbol("editable-tree:proxyTarget");

/**
 * A symbol to get a function, which returns the type of a node in contexts
 * where string keys are already in use for fields.
 */
export const getTypeSymbol: unique symbol = Symbol("editable-tree:getType()");

/**
 * A symbol to get the value of a node in contexts where string keys are already in use for fields.
 */
export const valueSymbol: unique symbol = Symbol("editable-tree:value");

/**
 * A symbol to get the anchor of a node in contexts where string keys are already in use for fields.
 */
export const anchorSymbol: unique symbol = Symbol("editable-tree:anchor");

/**
 * A tree which can be traversed and edited.
 *
 * When iterating, only visits non-empty fields.
 * To discover empty fields, inspect the schema using {@link getTypeSymbol}.
 *
 * TODO: support editing.
 */
export interface EditableTree extends Iterable<EditableField> {
    /**
     * A function to get the type of a node.
     * If this node is well-formed, it must follow this schema.
     * @param key - if key is supplied, returns the type of a non-sequence child node (if exists)
     * @param nameOnly - if true, returns only the type identifier
     */
    [getTypeSymbol](
        key?: FieldKey,
        nameOnly?: boolean,
    ): NamedTreeSchema | TreeSchemaIdentifier | undefined;

    /**
     * Value stored on this node.
     */
    readonly [valueSymbol]: Value;

    /**
     * Stores the target for the proxy which implements reading and writing for this node.
     * The details of this object are implementation details,
     * but the presence of this symbol can be used to separate EditableTrees from other types.
     */
    readonly [proxyTargetSymbol]: object;

    /**
     * Anchor to this node.
     * Valid as long as this EditableTree's context is not freed.
     * Might not point to any node if this node is deleted from the document.
     *
     * TODO: When a proper editing API is exposed on EditableTree directly,
     * this should become an implementation detail and rbe removed from this API surface.
     */
    readonly [anchorSymbol]: Anchor;

    /**
     * Fields of this node, indexed by their field keys.
     *
     * This API exposes content in a way depending on the {@link Multiplicity} of the {@link FieldKind}.
     * Sequences (including empty ones) are always exposed as {@link EditableField}s,
     * and everything else is either a single EditableTree or undefined depending on if it's empty.
     */
    readonly [key: FieldKey]: UnwrappedEditableField;

    /**
     * Gets an iterator iterating over the fields of this node.
     * It reads all fields at once before the iteration starts to get a "snapshot" of this node.
     * It might be inefficient regarding resources, but avoids situations
     * when the fields are getting changed while iterating.
     */
    [Symbol.iterator](): IterableIterator<EditableField>;
}

/**
 * EditableTree,
 * but with any type that `isPrimitive` unwrapped into the value if that value is a {@link PrimitiveValue}.
 */
export type EditableTreeOrPrimitive = EditableTree | PrimitiveValue;

/**
 * EditableTree, but with these cases of unwrapping:
 * - primitives are unwrapped. See {@link EditableTreeOrPrimitive}.
 * - nodes with PrimaryField (see `getPrimaryField`) are unwrapped to {@link EditableField}s.
 * - fields are unwrapped based on their schema's multiplicity. See {@link UnwrappedEditableField}.
 */
export type UnwrappedEditableTree = EditableTreeOrPrimitive | EditableField;

/**
 * A field of an {@link EditableTree} as an array-like sequence of unwrapped nodes (see {@link UnwrappedEditableTree}).
 *
 * The number of nodes depends on a field's multiplicity.
 * When iterating, the nodes are read at once. Use index access to read the nodes "lazily".
 * Use `getWithoutUnwrapping` to get a node without unwrapping.
 */
export interface EditableField extends ArrayLike<UnwrappedEditableTree> {
    /**
     * The `FieldSchema` of this field.
     */
    readonly fieldSchema: FieldSchema;

    /**
     * The `FieldKey` of this field.
     */
    readonly fieldKey: FieldKey;

    /**
     * The type name of the parent node.
     *
     * It is defined iff this field is the primary field of its parent node (see note on `EmptyKey`).
     */
    readonly primaryType?: TreeSchemaIdentifier;

    /**
     * Stores the target for the proxy which implements reading and writing for this sequence field.
     * The details of this object are implementation details,
     * but the presence of this symbol can be used to separate EditableTrees from other types.
     */
    readonly [proxyTargetSymbol]: object;

    /**
     * Gets a node of this field by its index without unwrapping.
     * Note that the node must exists at the given index.
     */
    getWithoutUnwrapping(index: number): EditableTree;

    /**
     * Gets an iterator iterating over the nodes (unwrapped) of this field.
     * See {@link UnwrappedEditableTree} for what does "unwrapped" mean.
     * It reads all nodes at once before the iteration starts to get a "snapshot" of this field.
     * It might be inefficient regarding resources, but avoids situations
     * when the field is getting changed while iterating.
     */
    [Symbol.iterator](): IterableIterator<UnwrappedEditableTree>;
}

/**
 * Unwrapped field.
 * Non-sequence multiplicities are unwrapped to the child tree or `undefined` if there is none.
 * Sequence multiplicities are handled with {@link EditableField}.
 * See {@link UnwrappedEditableTree} for how the children themselves are unwrapped.
 */
export type UnwrappedEditableField = UnwrappedEditableTree | undefined | EditableField;

/**
 * This is a base class for `NodeProxyTarget` and `FieldProxyTarget`, which uniformly handles cursors and anchors.
 */
export abstract class ProxyTarget<T extends Anchor | FieldAnchor> {
    private readonly lazyCursor: ITreeSubscriptionCursor;
    private anchor?: T;

    constructor(public readonly context: ProxyContext, cursor: ITreeSubscriptionCursor) {
        this.lazyCursor = cursor.fork();
        context.withCursors.add(this);
    }

    public free(): void {
        this.lazyCursor.free();
        this.context.withCursors.delete(this);
        if (this.anchor !== undefined) {
            this.forgetAnchor(this.anchor);
            this.context.withAnchors.delete(this);
            this.anchor = undefined;
        }
    }

    public getAnchor(): T {
        if (this.anchor === undefined) {
            this.anchor = this.buildAnchorFromCursor(this.lazyCursor);
            this.context.withAnchors.add(this);
        }
        return this.anchor;
    }

    public prepareForEdit(): void {
        this.getAnchor();
        this.lazyCursor.clear();
        this.context.withCursors.delete(this);
    }

    public get cursor(): ITreeSubscriptionCursor {
        if (this.lazyCursor.state === ITreeSubscriptionCursorState.Cleared) {
            assert(
                this.anchor !== undefined,
                0x3c3 /* EditableTree should have an anchor if it does not have a cursor */,
            );
            const result = this.tryMoveCursorToAnchor(this.anchor, this.lazyCursor);
            assert(
                result === TreeNavigationResult.Ok,
                0x3c4 /* It is invalid to access an EditableTree node which no longer exists */,
            );
            this.context.withCursors.add(this);
        }
        return this.lazyCursor;
    }

    abstract buildAnchorFromCursor(cursor: ITreeSubscriptionCursor): T;

    abstract tryMoveCursorToAnchor(
        anchor: T,
        cursor: ITreeSubscriptionCursor,
    ): TreeNavigationResult;

    abstract forgetAnchor(anchor: T): void;
}

function isFieldProxyTarget(target: ProxyTarget<Anchor | FieldAnchor>): target is FieldProxyTarget {
    return target instanceof FieldProxyTarget;
}

/**
 * A Proxy target, which together with a `nodeProxyHandler` implements a basic access to
 * the fields of {@link EditableTree} by means of the cursors.
 */
class NodeProxyTarget extends ProxyTarget<Anchor> {
    constructor(context: ProxyContext, cursor: ITreeSubscriptionCursor) {
        assert(cursor.mode === CursorLocationType.Nodes, "must be in nodes mode");
        super(context, cursor);
    }

    buildAnchorFromCursor(cursor: ITreeSubscriptionCursor): Anchor {
        return cursor.buildAnchor();
    }

    tryMoveCursorToAnchor(anchor: Anchor, cursor: ITreeSubscriptionCursor): TreeNavigationResult {
        return this.context.forest.tryMoveCursorToNode(anchor, cursor);
    }

    forgetAnchor(anchor: Anchor): void {
        this.context.forest.anchors.forget(anchor);
    }

    public getType(
        key?: FieldKey,
        nameOnly = true,
    ): NamedTreeSchema | TreeSchemaIdentifier | undefined {
        let typeName: TreeSchemaIdentifier | undefined = this.cursor.type;
        if (key !== undefined) {
            // TODO: remove option to use this for getting field types:
            // Once fields are properly wrapped, get the field, and get its type.

            const fieldKind = this.lookupFieldKind(key);
            if (fieldKind.multiplicity === Multiplicity.Sequence) {
                return undefined;
            }

            this.cursor.enterField(key);
            const types = mapCursorField(this.cursor, (c) => c.type);
            this.cursor.exitField();
            assert(types.length <= 1, 0x3c5 /* invalid non sequence */);
            typeName = types[0];
        }
        if (nameOnly) {
            return typeName;
        }
        if (typeName) {
            return {
                name: typeName,
                ...lookupTreeSchema(this.context.forest.schema, typeName),
            };
        }
        return undefined;
    }

    get value(): Value {
        return this.cursor.value;
    }

    public lookupFieldKind(field: FieldKey): FieldKind {
        return getFieldKind(
            getFieldSchema(
                field,
                this.context.forest.schema,
                this.getType(undefined, false) as NamedTreeSchema,
            ),
        );
    }

    public getFieldKeys(): FieldKey[] {
        return mapCursorFields(this.cursor, (c) => c.getFieldKey());
    }

    public has(field: FieldKey): boolean {
        // Make fields present only if non-empty.
        this.cursor.enterField(field);
        const length = this.cursor.getFieldLength();
        this.cursor.exitField();
        return length !== 0;
    }

    /**
     * @returns the key, if any, of the primary array field.
     */
    public getPrimaryArrayKey(): { key: LocalFieldKey; schema: FieldSchema } | undefined {
        const nodeType = this.getType(undefined, false) as NamedTreeSchema;
        const primary = getPrimaryField(nodeType);
        if (primary === undefined) {
            return undefined;
        }
        const kind = getFieldKind(primary.schema);
        if (kind.multiplicity === Multiplicity.Sequence) {
            // TODO: this could have issues if there are non-primary keys
            // that can collide with the array APIs (length or integers).
            return primary;
        }
        return undefined;
    }

    public proxifyField(field: FieldKey, unwrap = true): UnwrappedEditableField | EditableField {
        const fieldSchema = getFieldSchema(
            field,
            this.context.forest.schema,
            this.getType(undefined, false) as NamedTreeSchema,
        );
        this.cursor.enterField(field);
        const proxifiedField = proxifyField(this.context, fieldSchema, field, this.cursor, unwrap);
        this.cursor.exitField();
        return proxifiedField;
    }

    [Symbol.iterator](): IterableIterator<EditableField> {
        return this.getFieldKeys()
            .map((fieldKey) => this.proxifyField(fieldKey, false) as EditableField)
            .values();
    }
}

/**
 * A Proxy handler together with a {@link NodeProxyTarget} implements a basic read/write access to the Forest
 * by means of the cursors.
 */
const nodeProxyHandler: AdaptingProxyHandler<NodeProxyTarget, EditableTree> = {
    get: (target: NodeProxyTarget, key: string | symbol): unknown => {
        if (typeof key === "string" || symbolIsFieldKey(key)) {
            // All string keys are fields
            return target.proxifyField(brand(key));
        }
        // utility symbols
        switch (key) {
            case getTypeSymbol:
                return target.getType.bind(target);
            case valueSymbol:
                return target.value;
            case proxyTargetSymbol:
                return target;
            case anchorSymbol:
                return target.getAnchor();
            case Symbol.iterator:
                return target[Symbol.iterator].bind(target);
            default:
                return undefined;
        }
    },
    set: (
        target: NodeProxyTarget,
        key: string | symbol,
        setValue: unknown,
        receiver: NodeProxyTarget,
    ): boolean => {
        throw new Error("Not implemented.");
    },
    deleteProperty: (target: NodeProxyTarget, key: string | symbol): boolean => {
        throw new Error("Not implemented.");
    },
    // Include documented symbols (except value when value is undefined) and all non-empty fields.
    has: (target: NodeProxyTarget, key: string | symbol): boolean => {
        if (typeof key === "string" || symbolIsFieldKey(key)) {
            return target.has(brand(key));
        }
        // utility symbols
        switch (key) {
            case proxyTargetSymbol:
            case getTypeSymbol:
            case anchorSymbol:
            case Symbol.iterator:
                return true;
            case valueSymbol:
                // Could do `target.value !== ValueSchema.Nothing`
                // instead if values which could be modified should report as existing.
                return target.value !== undefined;
            default:
                return false;
        }
    },
    // Includes all non-empty fields, which are the enumerable fields.
    ownKeys: (target: NodeProxyTarget): FieldKey[] => {
        return target.getFieldKeys();
    },
    getOwnPropertyDescriptor: (
        target: NodeProxyTarget,
        key: string | symbol,
    ): PropertyDescriptor | undefined => {
        // We generally don't want to allow users of the proxy to reconfigure all the properties,
        // but it is an TypeError to return non-configurable for properties that do not exist on target,
        // so they must return true.

        if ((typeof key === "string" || symbolIsFieldKey(key)) && target.has(brand(key))) {
            return {
                configurable: true,
                enumerable: true,
                value: target.proxifyField(brand(key)),
                writable: false,
            };
        }
        // utility symbols
        switch (key) {
            case proxyTargetSymbol:
                return { configurable: true, enumerable: false, value: target, writable: false };
            case getTypeSymbol:
                return {
                    configurable: true,
                    enumerable: false,
                    value: target.getType.bind(target),
                    writable: false,
                };
            case valueSymbol:
                return {
                    configurable: true,
                    enumerable: false,
                    value: target.value,
                    writable: false,
                };
            case anchorSymbol:
                return {
                    configurable: true,
                    enumerable: false,
                    value: target.getAnchor(),
                    writable: false,
                };
            case Symbol.iterator:
                return {
                    configurable: true,
                    enumerable: false,
                    value: target[Symbol.iterator].bind(target),
                    writable: false,
                };
            default:
                return undefined;
        }
    },
};

/**
 * A Proxy target, which together with a `fieldProxyHandler` implements a basic access to
 * the nodes of {@link EditableField} by means of the cursors.
 */
class FieldProxyTarget extends ProxyTarget<FieldAnchor> implements EditableField {
    public readonly fieldKey: FieldKey;
    public readonly fieldSchema: FieldSchema;
    public readonly primaryType?: TreeSchemaIdentifier;

    constructor(
        context: ProxyContext,
        fieldSchema: FieldSchema,
        cursor: ITreeSubscriptionCursor,
        primaryType?: TreeSchemaIdentifier,
    ) {
        assert(cursor.mode === CursorLocationType.Fields, "must be in fields mode");
        super(context, cursor);
        this.fieldKey = cursor.getFieldKey();
        this.primaryType = primaryType;
        this.fieldSchema = fieldSchema;
    }

    get [proxyTargetSymbol](): FieldProxyTarget {
        return this;
    }

    buildAnchorFromCursor(cursor: ITreeSubscriptionCursor): FieldAnchor {
        return cursor.buildFieldAnchor();
    }

    tryMoveCursorToAnchor(
        anchor: FieldAnchor,
        cursor: ITreeSubscriptionCursor,
    ): TreeNavigationResult {
        return this.context.forest.tryMoveCursorToField(anchor, cursor);
    }

    forgetAnchor(anchor: FieldAnchor): void {
        if (anchor.parent === undefined) return;
        this.context.forest.anchors.forget(anchor.parent);
    }

    readonly [index: number]: UnwrappedEditableTree;

    public get length(): number {
        return this.cursor.getFieldLength();
    }

    /**
     * Returns a node (unwrapped by default, see {@link UnwrappedEditableTree}) by its index.
     */
    public proxifyNode(index: number, unwrap = true): UnwrappedEditableTree {
        this.cursor.enterNode(index);
        const target = new NodeProxyTarget(this.context, this.cursor);
        this.cursor.exitNode();
        return inProxyOrUnwrap(target, unwrap);
    }

    /**
     * Gets a node by its index without unwrapping.
     */
    public getWithoutUnwrapping(index: number): EditableTree {
        assert(
            keyIsValidIndex(index, this.length),
            "A child node must exist at index to get it without unwrapping.",
        );
        return this.proxifyNode(index, false) as EditableTree;
    }

    /**
     * Gets array of unwrapped nodes.
     */
    private asArray(): UnwrappedEditableTree[] {
        return mapCursorField(this.cursor, (c) =>
            inProxyOrUnwrap(new NodeProxyTarget(this.context, c), true),
        );
    }

    [Symbol.iterator](): IterableIterator<UnwrappedEditableTree> {
        return this.asArray().values();
    }
}

/**
 * The set of `EditableField` properties exposed by `fieldProxyHandler`.
 * Any other properties are considered to be non-existing.
 */
const editableFieldPropertySet = new Set<PropertyKey>([
    "length",
    "fieldKey",
    "fieldSchema",
    "primaryType",
]);

/**
 * Returns a Proxy handler, which together with a {@link FieldProxyTarget} implements a basic read/write access to
 * the sequence fields by means of the cursors.
 */
const fieldProxyHandler: AdaptingProxyHandler<FieldProxyTarget, EditableField> = {
    get: (target: FieldProxyTarget, key: string | symbol, receiver: object): unknown => {
        if (typeof key === "string") {
            if (editableFieldPropertySet.has(key)) {
                return Reflect.get(target, key);
            } else if (keyIsValidIndex(key, target.length)) {
                return target.proxifyNode(Number(key));
            }
            // This maps the methods of the `EditableField` to their implementation in the `FieldProxyTarget`.
            // Expected are only the methods declared in the `EditableField` interface,
            // as only those are visible for the users of the public API.
            // Such implicit delegation is chosen for a future array implementation in case it will be needed.
            const reflected = Reflect.get(target, key);
            if (typeof reflected === "function") {
                return function (...args: unknown[]): unknown {
                    return Reflect.apply(reflected, target, args);
                };
            }
            return undefined;
        }
        switch (key) {
            case proxyTargetSymbol:
                return target;
            case Symbol.iterator:
                return target[Symbol.iterator].bind(target);
            default:
        }
        return undefined;
    },
    set: (target: FieldProxyTarget, key: string, value: unknown, receiver: unknown): boolean => {
        throw new Error("Not implemented");
    },
    deleteProperty: (target: FieldProxyTarget, key: string): boolean => {
        throw new Error("Not supported");
    },
    // Include documented symbols and all non-empty fields.
    has: (target: FieldProxyTarget, key: string | symbol): boolean => {
        if (typeof key === "symbol") {
            switch (key) {
                case Symbol.iterator:
                case proxyTargetSymbol:
                    return true;
                default:
            }
        } else {
            if (keyIsValidIndex(key, target.length) || editableFieldPropertySet.has(key)) {
                return true;
            }
        }
        return false;
    },
    ownKeys: (target: FieldProxyTarget): ArrayLike<keyof EditableField> => {
        // This includes 'length' property.
        const keys: string[] = getOwnArrayKeys(target.length);
        keys.push("fieldKey", "fieldSchema", "primaryType");
        return keys as ArrayLike<keyof EditableField>;
    },
    getOwnPropertyDescriptor: (
        target: FieldProxyTarget,
        key: string | symbol,
    ): PropertyDescriptor | undefined => {
        if (typeof key === "symbol") {
            switch (key) {
                case proxyTargetSymbol:
                    return {
                        configurable: false,
                        enumerable: false,
                        value: target,
                        writable: false,
                    };
                case Symbol.iterator:
                    return {
                        configurable: false,
                        enumerable: false,
                        value: target[Symbol.iterator].bind(target),
                        writable: false,
                    };
                default:
            }
        } else {
            if (editableFieldPropertySet.has(key)) {
                // We generally don't want to allow users of the proxy to reconfigure all the properties,
                // but it is a TypeError to return non-configurable for properties that do not exist on target,
                // so they must return true.
                return {
                    configurable: true,
                    enumerable: false,
                    value: Reflect.get(target, key),
                    writable: false,
                };
            } else if (keyIsValidIndex(key, target.length)) {
                return {
                    configurable: true,
                    enumerable: true,
                    value: target.proxifyNode(Number(key)),
                    writable: false,
                };
            }
        }
        return undefined;
    },
};

/**
 * See {@link UnwrappedEditableTree} for documentation on what unwrapping this performs.
 */
function inProxyOrUnwrap(
    target: NodeProxyTarget | FieldProxyTarget,
    unwrap: boolean,
): UnwrappedEditableTree {
    // Unwrap primitives or nodes having a primary field. Sequences unwrap nodes on their own.
    if (unwrap && !isFieldProxyTarget(target)) {
        const nodeType = target.getType(undefined, false) as NamedTreeSchema;
        if (isPrimitive(nodeType)) {
            const nodeValue = target.cursor.value;
            if (isPrimitiveValue(nodeValue)) {
                return nodeValue;
            }
            assert(
                nodeType.value === ValueSchema.Serializable,
                0x3c7 /* `undefined` values not allowed for primitive fields */,
            );
        }
        const primary = target.getPrimaryArrayKey();
        if (primary !== undefined) {
            target.cursor.enterField(primary.key);
            const primarySequence = new FieldProxyTarget(
                target.context,
                primary.schema,
                target.cursor,
                nodeType.name,
            );
            return adaptWithProxy(primarySequence, fieldProxyHandler);
        }
    }
    return isFieldProxyTarget(target)
        ? adaptWithProxy(target, fieldProxyHandler)
        : adaptWithProxy(target, nodeProxyHandler);
}

/**
 * @param context - the common context of the field.
 * @param fieldSchema - the FieldSchema of the field.
 * @param fieldKey - the key of the field. Used to visualize the tree.
 * @param cursor - the cursor, which must point to the field being proxified.
 * @param unwrap - if true, the field is unwrapped (see {@link UnwrappedEditableField}),
 * otherwise always returns the field as {@link EditableField}.
 */
export function proxifyField(
    context: ProxyContext,
    fieldSchema: FieldSchema,
    fieldKey: FieldKey,
    cursor: ITreeSubscriptionCursor,
    unwrap: boolean,
): UnwrappedEditableField {
    if (!unwrap) {
        const targetSequence = new FieldProxyTarget(context, fieldSchema, cursor);
        return inProxyOrUnwrap(targetSequence, unwrap);
    }
    const fieldKind = getFieldKind(fieldSchema);
    if (fieldKind.multiplicity === Multiplicity.Sequence) {
        const targetSequence = new FieldProxyTarget(context, fieldSchema, cursor);
        return inProxyOrUnwrap(targetSequence, unwrap);
    }
    const length = cursor.getFieldLength();
    assert(length <= 1, 0x3c8 /* invalid non sequence */);
    if (length === 1) {
        cursor.enterNode(0);
        const target = new NodeProxyTarget(context, cursor);
        const proxifiedNode = inProxyOrUnwrap(target, unwrap);
        cursor.exitNode();
        return proxifiedNode;
    }
    return undefined;
}

/**
 * A simple API for a Forest to interact with the tree.
 *
 * @returns {@link EditableTreeContext} which is used manage the cursors and anchors within the EditableTrees:
 * This is necessary for supporting using this tree across edits to the forest, and not leaking memory.
 */
export function getEditableTreeContext(forest: IEditableForest): EditableTreeContext {
    return new ProxyContext(forest);
}

/**
 * Checks the type of an UnwrappedEditableField.
 */
export function isUnwrappedNode(field: UnwrappedEditableField): field is EditableTree {
    return typeof field === "object" && !isEditableField(field);
}

/**
 * Checks the type of an UnwrappedEditableField.
 */
export function isEditableField(field: UnwrappedEditableField): field is EditableField {
    return (
        typeof field === "object" &&
        isFieldProxyTarget(field[proxyTargetSymbol] as ProxyTarget<Anchor | FieldAnchor>)
    );
}
