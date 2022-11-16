/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */
import { IContainer } from "@fluidframework/container-definitions";
import { IFluidLoadable } from "@fluidframework/core-interfaces";

import { FluidClientDebugger } from "./FluidClientDebugger";
import { IFluidClientDebugger } from "./IFluidClientDebugger";

/**
 * Properties for configuring a {@link IFluidClientDebugger}.
 */
export interface FluidClientDebuggerProps {
	/**
	 * The ID of the Container with which the debugger will be associated.
	 */
	containerId: string;

	/**
	 * The Container with which the debugger will be associated.
	 */
	container: IContainer;

	/**
	 * Data belonging to the Container.
	 *
	 * @remarks The debugger will not mutate this data.
	 */
	containerData: Record<string, IFluidLoadable>;
}

/**
 * Initializes a {@link IFluidClientDebugger} from the provided properties, binding it to the global context.
 *
 * @remarks
 *
 * If there is an existing debugger session associated with the provided {@link FluidClientDebuggerProps.containerId},
 * the existing debugger session will be closed, and a new one will be generated from the provided props.
 */
export function initializeFluidClientDebugger(props: FluidClientDebuggerProps): void {
	const { containerId, container, containerData } = props;

	const debuggerRegistry = getDebuggerRegistry();

	const existingDebugger = debuggerRegistry.get(containerId);
	if (existingDebugger !== undefined) {
		console.warn(
			`Active debugger registry already contains an entry for container ID "${containerId}". Overriding use existing entry.`,
		);
		existingDebugger.dispose();
	}
	debuggerRegistry.set(
		containerId,
		new FluidClientDebugger(containerId, container, containerData),
	);
}

/**
 * Adds an externally-created debugger instance to the registry, keyed off of its {@link IFluidClientDebugger.containerId}.
 *
 * @internal
 */
export function setFluidClientDebugger(clientDebugger: IFluidClientDebugger): void {
	const debuggerRegistry = getDebuggerRegistry();

	const containerId = clientDebugger.containerId;

	const existingDebugger = debuggerRegistry.get(containerId);
	if (existingDebugger !== undefined) {
		console.warn(
			`Active debugger registry already contains an entry for container ID "${containerId}". Overriding use existing entry.`,
		);
		existingDebugger.dispose();
	}
	debuggerRegistry.set(containerId, clientDebugger);
}

/**
 * Closes ({@link IFluidClientDebugger.dispose | disposes}) a registered client debugger associated with the
 * provided Container ID.
 */
export function closeFluidClientDebugger(containerId: string): void {
	const debuggerRegistry = getDebuggerRegistry();

	const clientDebugger = debuggerRegistry.get(containerId);
	if (clientDebugger === undefined) {
		console.warn(
			`No active client debugger associated with container ID "${containerId}" was found.`,
		);
	} else {
		clientDebugger.dispose();
		debuggerRegistry.delete(containerId);
	}
}

/**
 * Gets the registered client debugger associated with the provided Container ID if one is registered.
 * Will return `undefined` if no such debugger is registered.
 */
export function getFluidClientDebugger(containerId: string): IFluidClientDebugger | undefined {
	const debuggerRegistry = getDebuggerRegistry();
	return debuggerRegistry.get(containerId);
}

/**
 * Gets all registered client debuggers from the registry.
 *
 * @internal
 */
export function getFluidClientDebuggers(): IFluidClientDebugger[] {
	const debuggerRegistry = getDebuggerRegistry();

	const clientDebuggers: IFluidClientDebugger[] = [];
	for (const [, clientDebugger] of debuggerRegistry) {
		clientDebuggers.push(clientDebugger);
	}

	return clientDebuggers;
}

/**
 * Gets the debugger registry from the window. Initializes it if one does not yet exist.
 *
 * @throws Throws an error if initialization / binding to the window object fails.
 *
 * @internal
 */
export function getDebuggerRegistry(): Map<string, IFluidClientDebugger> {
	if (globalThis.fluidClientDebuggers === undefined) {
		// If no client debuggers have been bound, initialize list
		globalThis.fluidClientDebuggers = new Map<string, IFluidClientDebugger>();
	}

	const debuggerRegistry = globalThis.fluidClientDebuggers as Map<string, IFluidClientDebugger>;

	if (debuggerRegistry === undefined) {
		throw new Error("Fluid Client debugger registry initialization failed.");
	}

	return debuggerRegistry;
}

/**
 * Clears the debugger registry, disposing of any remaining debugger objects.
 *
 * @internal
 */
export function clearDebuggerRegistry(): void {
	const debuggerRegistry = globalThis.fluidClientDebuggers as Map<string, IFluidClientDebugger>;
	if (debuggerRegistry !== undefined) {
		for (const [, clientDebugger] of debuggerRegistry) {
			if (clientDebugger.disposed) {
				console.warn(`Fluid Client debugger has already been disposed.`);
			} else {
				clientDebugger.dispose();
			}
		}
	}

	globalThis.fluidClientDebuggers = undefined;
}
