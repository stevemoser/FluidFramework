/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

import type { IEvent, IEventProvider } from "@fluidframework/common-definitions";
import { IResolvedUrl } from "@fluidframework/driver-definitions";
import { SharedString } from "@fluidframework/sequence";

/**
 * Interface for interacting with external task data stored in root {@link @fluidframework/map#SharedDirectory}.
 */
export interface ExternalSnapshotTask {
	id: string;
	name: string | undefined;
	priority: number | undefined;
	changeType: string | undefined;
}

/**
 * Events emitted by {@link IAppModel}.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface IAppModelEvents extends IEvent {}

/**
 * For this simple demo, our app model only needs a single member taskList.
 */
export interface IAppModel extends IEventProvider<IAppModelEvents> {
	/**
	 * Represents the document where one or more task tracker lists will be rendered
	 */
	readonly baseDocument: IBaseDocument;

	/**
	 * Send custom signal to simulate being the RuntimeMessage signal
	 * from alfred while that signal is in prototype state on the dev branch.
	 */
	readonly sendCustomDebugSignal: () => void;

	/**
	 * Returns the resolved URL for the attached container. If container is not
	 * attached then returns undefined.
	 */
	readonly getContainerResolvedUrl: () => IResolvedUrl | undefined;
}

/**
 * Events emitted by {@link ITask}.
 */
export interface ITaskEvents extends IEvent {
	/**
	 * Emitted when the name has changed.
	 */
	(event: "draftNameChanged", listener: () => void);
	/**
	 * Emitted when the priority has changed.
	 */
	(event: "draftPriorityChanged", listener: () => void);
	/**
	 * Emitted when the name from the source (the external server) has changed.
	 */
	(event: "externalNameChanged", listener: () => void);
	/**
	 * Emitted when priority from the source (the external server) has changed.
	 */
	(event: "externalPriorityChanged", listener: () => void);
	/**
	 * Emitted when there are differences between the draft data and external snapshot data.
	 */
	(event: "changesAvailable", listener: (value: boolean) => boolean);
}

/**
 * A single task, with functionality to inspect and modify its data.  Changes to this object will update the state
 * of the Fluid object, but will not automatically update the external data source.
 */
export interface ITask extends IEventProvider<ITaskEvents> {
	/**
	 * The immutable ID for the task.
	 */
	readonly id: string;
	/**
	 * The task name.  Modifications are persisted in Fluid and shared amongst collaborators.
	 */
	readonly draftName: SharedString;
	/**
	 * The task priority.  Modifications are persisted in Fluid and shared amongst collaborators.
	 */
	draftPriority: number;
	/**
	 * Overwrite the draft data with the external data that's coming in.
	 */
	readonly overwriteWithExternalData: () => void;
	/**
	 * The data coming in from the external server.
	 */
	readonly externalDataSnapshot: ExternalSnapshotTask;
}

/**
 * Events emitted by {@link ITaskList}.
 */
export interface ITaskListEvents extends IEvent {
	/**
	 * Emitted when a draft task is added.
	 */
	(event: "draftTaskAdded", listener: (task: ITask) => void);
	/**
	 * Emitted when a draft task is removed.
	 */
	(event: "draftTaskDeleted", listener: (task: ITask) => void);
}

/**
 * ITaskList represents a "drafting surface" for changes to a task list stored in some external source.  Changes to
 * the ITaskList and its constituent ITasks are persisted in Fluid and shared amongst collaborators, but none of the
 * changes are persisted back to the external source until the user explicitly chooses to do so.
 * TODO: We'll want to eventually show variations of this behavior (e.g. more automatic or less automatic sync'ing).
 */
export interface ITaskList extends IEventProvider<ITaskListEvents> {
	/**
	 * Add a task with the specified ID, initial name, and priority.
	 * TODO: most likely, the ID should be automatically generated by the external source.  However, we won't
	 * actually be adding this task to the external data source until a sync happens.  What should the ID be in the
	 * interim period -- e.g. is there a "Fluid ID" vs. the real ID?
	 */
	readonly addDraftTask: (id: string, name: string, priority: number) => void;
	/**
	 * Delete the task with the specified ID.
	 */
	readonly deleteDraftTask: (id: string) => void;

	/**
	 * Get the full list of tasks.
	 */
	readonly getDraftTasks: () => ITask[];
	/**
	 * Get the task with the specified ID.
	 */
	readonly getDraftTask: (id: string) => ITask | undefined;

	/**
	 * Persist the current state of the Fluid data back to the external data source.
	 */
	readonly writeToExternalServer: () => Promise<void>;

	/**
	 * Kick off fetching external data directly from the TaskList.
	 * Triggered on receipt of ExternalDataChanged signal from container.
	 */
	readonly importExternalData: () => Promise<void>;

	// TODO: Should there be an imperative API to trigger importing changes from the external source?
	// Even if we don't want this to be how the signal gets routed, we might want a "fetch latest changes" button
	// in the UI.
	// readonly fetchNewChanges: () => Promise<void>;

	// TODO: For the signal we might prefer routing it in as an unknown message payload, delegating interpretation
	// Alternate: inject an EventEmitter that raises the events from external.
	// readonly handleExternalMessage: (message) => void;
}

/**
 * Events emitted by {@link IBaseDocumentEvents}.
 */
export interface IBaseDocumentEvents extends IEvent {
	/**
	 * Emitted when task list collection has changed.
	 */
	(event: "taskListCollectionChanged", listener: () => void);
}

/**
 * Properties necessary to instantiate a {@link ITaskList}.
 * TODO: Figure out a better form factor for passing these in once we know all the pieces necessary.
 */
export interface IBaseDocumentInitialState {
	externalTaskListId: string;
	containerUrl: IResolvedUrl;
}

/**
 * A single DataStore object that allows the app to load and the container to instantiate
 * without a instantiating {@link ITaskList} right away.
 */
export interface IBaseDocument extends IEventProvider<IBaseDocumentEvents> {
	/**
	 * Add a task list with a specific id.
	 */
	readonly addTaskList: (props: IBaseDocumentInitialState) => void;
	/**
	 * Get the task list with the specified ID.
	 */
	readonly getTaskList: (id: string) => ITaskList | undefined;
}

export { assertValidTaskData, ITaskListData, ITaskData } from "./TaskData";
