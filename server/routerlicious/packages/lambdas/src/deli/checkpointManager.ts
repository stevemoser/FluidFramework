/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

import {
	ICheckpointRepository,
	ICheckpointService,
	IDeliState,
	IDocumentRepository,
	IQueuedMessage,
} from "@fluidframework/server-services-core";
import { CheckpointReason } from "../utils";

export interface IDeliCheckpointManager {
	writeCheckpoint(
		checkpoint: IDeliState,
		isLocal: boolean,
		reason: CheckpointReason,
	): Promise<void>;
	deleteCheckpoint(checkpointParams: ICheckpointParams, isLocal: boolean): Promise<void>;
}

export interface ICheckpointParams {
	/**
	 * The reason why this checkpoint was triggered
	 */
	reason: CheckpointReason;

	/**
	 * The deli checkpoint state \@ deliCheckpointMessage
	 */
	deliState: IDeliState;

	/**
	 * The message to checkpoint for deli (mongodb)
	 */
	deliCheckpointMessage: IQueuedMessage;

	/**
	 * The message to checkpoint for kafka
	 */
	kafkaCheckpointMessage: IQueuedMessage | undefined;

	/**
	 * Flag that decides if the deli checkpoint should be deleted
	 */
	clear?: boolean;
}

export function createDeliCheckpointManagerFromCollection(
	tenantId: string,
	documentId: string,
	documentRepository: IDocumentRepository,
	checkpointRepository: ICheckpointRepository,
    checkpointService: ICheckpointService,
): IDeliCheckpointManager {
	const checkpointManager = {
		writeCheckpoint: async (checkpoint: IDeliState, isLocal: boolean) => {
            return checkpointService.writeCheckpointToCollection(documentId, tenantId, "deli", checkpoint, isLocal);
		},
		deleteCheckpoint: async (checkpointParams: ICheckpointParams, isLocal: boolean) => {
			// eslint-disable-next-line @typescript-eslint/no-unsafe-return
			return checkpointService.removeCheckpointFromCollection(documentId, tenantId, "deli", isLocal)
		},
	};
	return checkpointManager;
}

