/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

import { ISourcedDebuggerMessage } from "@fluid-tools/client-debugger";

/**
 * A {@link chrome.runtime.Port} with specific types which it expects to send and receive.
 *
 * @typeParam TSend - The type of message sent to this port connection.
 * @typeParam TReceive - The type of message received by this port connection.
 */
export interface TypedPortConnection<
	TSend extends ISourcedDebuggerMessage = ISourcedDebuggerMessage,
	TReceive extends ISourcedDebuggerMessage = ISourcedDebuggerMessage,
> extends chrome.runtime.Port {
	/**
	 * Type-safe override of {@link chrome.runtime.Port.postMessage}.
	 *
	 * @override
	 */
	postMessage: (message: TSend) => void;

	/**
	 * Type-safe override of {@link chrome.runtime.Port.onMessage}.
	 *
	 * @override
	 */
	onMessage: chrome.events.Event<
		(message: TReceive, port: TypedPortConnection<TSend, TReceive>) => void
	>;
}