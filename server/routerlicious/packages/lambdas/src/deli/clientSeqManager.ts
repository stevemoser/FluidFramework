/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

import { Heap, IComparer, IHeapNode } from "@fluidframework/common-utils";
import { IClientSequenceNumber } from "@fluidframework/server-services-core";

const SequenceNumberComparer: IComparer<IClientSequenceNumber> = {
	compare: (a, b) => a.referenceSequenceNumber - b.referenceSequenceNumber,
	min: {
		canEvict: true,
		clientId: undefined,
		clientSequenceNumber: 0,
		lastUpdate: -1,
		nack: false,
		referenceSequenceNumber: -1,
		scopes: [],
	},
};

export class ClientSequenceNumberManager {
	private readonly clientNodeMap = new Map<string, IHeapNode<IClientSequenceNumber>>();
	private readonly clientSeqNumbers = new Heap<IClientSequenceNumber>(SequenceNumberComparer);

	public has(clientId: string): boolean {
		return this.clientNodeMap.has(clientId);
	}

	public get(clientId: string): IClientSequenceNumber | undefined {
		const node = this.clientNodeMap.get(clientId);
		if (node === undefined) {
			return undefined;
		}
		return node.value;
	}

	public count() {
		return this.clientNodeMap.size;
	}

	public peek() {
		const node = this.clientSeqNumbers.peek();
		if (node === undefined) {
			return undefined;
		}
		return node.value;
	}

	public cloneValues(): IClientSequenceNumber[] {
		const clients: IClientSequenceNumber[] = [];
		for (const [, value] of this.clientNodeMap) {
			const source = value.value;
			clients.push({ ...source });
		}
		return clients;
	}

	/**
	 * Begins tracking or updates an already tracked client.
	 * @param clientId - The client identifier
	 * @param clientSequenceNumber - The sequence number generated by client
	 * @param referenceSequenceNumber - The sequence number the client is at
	 * @param timestamp - The time of the operation
	 * @param canEvict - Flag indicating whether or not we can evict the client (branch clients cannot be evicted)
	 * @param scopes - scope of the client
	 * @param nack - Flag indicating whether we have nacked this client
	 * @param serverMetadata - Optional server provided metadata to associate with the client
	 * Returns false if the same client has been added earlier.
	 */
	public upsertClient(
		clientId: string,
		clientSequenceNumber: number,
		referenceSequenceNumber: number,
		timestamp: number,
		canEvict: boolean,
		scopes: string[] = [],
		nack: boolean = false,
		serverMetadata: any = undefined,
	): boolean {
		const client = this.clientNodeMap.get(clientId);
		if (client) {
			client.value.referenceSequenceNumber = referenceSequenceNumber;
			client.value.clientSequenceNumber = clientSequenceNumber;
			client.value.lastUpdate = timestamp;
			client.value.nack = nack;

			if (serverMetadata) {
				// update serverMetadata if it's provided
				client.value.serverMetadata = serverMetadata;
			}

			this.clientSeqNumbers.update(client);
			return false;
		}

		// Add the client ID to our map since this is the first time we've seen it
		const newNode = this.clientSeqNumbers.add({
			canEvict,
			clientId,
			clientSequenceNumber,
			lastUpdate: timestamp,
			nack,
			referenceSequenceNumber,
			scopes,
			serverMetadata,
		});
		this.clientNodeMap.set(clientId, newNode);
		return true;
	}

	/**
	 * Removes the provided client from the list of tracked clients.
	 * Returns false if the client has been removed earlier.
	 */
	public removeClient(clientId: string): boolean {
		const details = this.clientNodeMap.get(clientId);
		if (!details) {
			return false;
		}

		// Remove the client from the list of nodes
		this.clientSeqNumbers.remove(details);
		this.clientNodeMap.delete(clientId);
		return true;
	}

	/**
	 * Retrieves the minimum sequence number.
	 */
	public getMinimumSequenceNumber(): number {
		if (this.clientSeqNumbers.count() > 0) {
			const client = this.clientSeqNumbers.peek();
			return client.value.referenceSequenceNumber;
		} else {
			return -1;
		}
	}
}
