/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

import * as fs from "fs";

interface ParsedJob {
	stageName: string;
	startTime: number;
	finishTime: number;
	state: string;
	result: string;
}
function parseJobData(inputPath: string, outputPath: string) {
	fs.readFile(inputPath, (err: NodeJS.ErrnoException | null, data: Buffer) => {
		if (err !== null) {
			throw err;
		}
		const entireFile: Record<string, any> = JSON.parse(data.toString());

		const jobs = entireFile.records;

		const parsedJobs: ParsedJob[] = jobs
			.filter((job) => job.type === "Stage")
			.map((job) => {
				const startTime = Date.parse(job.startTime?.toString()) ?? undefined;
				const finishTime = Date.parse(job.finishTime?.toString()) ?? undefined;
				const dateDiff =
					finishTime && startTime ? Math.abs(finishTime - startTime) / 1000 : undefined; // diff in seconds
				const hours = dateDiff !== undefined ? Math.floor(dateDiff / 3600) : undefined;
				const minutes =
					dateDiff !== undefined ? Math.floor((dateDiff % 3600) / 60) : undefined;
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

		const outputJson = JSON.stringify(parsedJobs, null, 2);

		fs.writeFile(outputPath, outputJson, (err1) => {
			if (err1 !== null) throw err1;
			console.log(`Parsed jobs saved to ${outputPath}`);
		});
	});
}

const inputFilePath = process.argv[2];
const outputFilePath = process.argv[3];
parseJobData(inputFilePath, outputFilePath);
