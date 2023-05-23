/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */
interface ParsedJob {
	stageName: string;
	startTime: number;
	finishTime: number;
	totalTime: number;
	state: string;
	result: string;
}

module.exports = function handler(fileData, logger) {
	// - fileData is a JSON object obtained by calling JSON.parse() on the contents of a file.
	// - logger is an ITelemetryBufferedLogger. Call its send() method to write the output telemetry
	//   events.
	if (fileData.records?.length === undefined || fileData.records?.length === 0) {
		console.log(`could not locate records info`);
	}

	const parsedJobs: ParsedJob[] = fileData.records
		.filter((job) => job.type === "Stage")
		.map((job) => {
			const startTime = Date.parse(job.startTime?.toString()) ?? undefined;
			const finishTime = Date.parse(job.finishTime?.toString()) ?? undefined;
			const dateDiff =
				finishTime && startTime ? Math.abs(finishTime - startTime) / 1000 : undefined; // diff in seconds
			const hours = dateDiff !== undefined ? Math.floor(dateDiff / 3600) : undefined;
			const minutes = dateDiff !== undefined ? Math.floor((dateDiff % 3600) / 60) : undefined;
			const seconds = dateDiff !== undefined ? Math.floor(dateDiff % 60) : undefined;
			console.log(`Name=${job.name}`);
			return {
				stageName: job.name,
				startTime,
				finishTime,
				totalTime: dateDiff,
				formattedTime:
					dateDiff !== undefined
						? `${hours} hours, ${minutes} minutes and ${seconds} seconds`
						: undefined,
				state: job.state,
				result: job.result,
			};
		});

	for (const job of parsedJobs) {
		// we only need .js files
		logger.send({
			category: "performance",
			eventName: "StageTiming",
			benchmarkType: "PipelineInfo",
			name: job.stageName,
			duration: job.totalTime,
			state: job.state,
			result: job.result,
		});
	}
};
