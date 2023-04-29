/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

import { AsyncLocalStorage } from "async_hooks";
import * as git from "@fluidframework/gitresources";
import { IThrottler, ITokenRevocationManager } from "@fluidframework/server-services-core";
import {
	IThrottleMiddlewareOptions,
	throttle,
	getParam,
} from "@fluidframework/server-services-utils";
import { Lumberjack } from "@fluidframework/server-services-telemetry";
import { Router } from "express";
import * as nconf from "nconf";
import winston from "winston";
import { ICache, ITenantService } from "../../services";
import * as utils from "../utils";
import { Constants } from "../../utils";

export function create(
	config: nconf.Provider,
	tenantService: ITenantService,
	restTenantThrottlers: Map<string, IThrottler>,
	cache?: ICache,
	asyncLocalStorage?: AsyncLocalStorage<string>,
	tokenRevocationManager?: ITokenRevocationManager,
): Router {
	const router: Router = Router();

	const tenantThrottleOptions: Partial<IThrottleMiddlewareOptions> = {
		throttleIdPrefix: (req) => getParam(req.params, "tenantId"),
		throttleIdSuffix: Constants.historianRestThrottleIdSuffix,
	};
	const restTenantGeneralThrottler = restTenantThrottlers.get(
		Constants.generalRestCallThrottleIdPrefix,
	);

	async function createBlob(
		tenantId: string,
		authorization: string,
		body: git.ICreateBlobParams,
	): Promise<git.ICreateBlobResponse> {
		const service = await utils.createGitService({
			config,
			tenantId,
			authorization,
			tenantService,
			cache,
			asyncLocalStorage,
		});
		return service.createBlob(body);
	}

	async function getBlob(
		tenantId: string,
		authorization: string,
		sha: string,
		useCache: boolean,
	): Promise<git.IBlob> {
		const service = await utils.createGitService({
			config,
			tenantId,
			authorization,
			tenantService,
			cache,
			asyncLocalStorage,
		});
		return service.getBlob(sha, useCache);
	}

	/**
	 * Historian https ping endpoint for availability monitoring system
	 */
	router.get(
		"/repos/ping",
		throttle(restTenantGeneralThrottler, winston, {
			...tenantThrottleOptions,
			throttleIdPrefix: "ping",
		}),
		async (request, response) => {
			response.sendStatus(200);
		},
	);

	router.post(
		"/repos/:ignored?/:tenantId/git/blobs",
		utils.validateRequestParams("tenantId"),
		throttle(restTenantGeneralThrottler, winston, tenantThrottleOptions),
		utils.verifyTokenNotRevoked(tokenRevocationManager),
		(request, response, next) => {
			const blobP = createBlob(
				request.params.tenantId,
				request.get("Authorization"),
				request.body,
			);
			utils.handleResponse(blobP, response, false, 201);
		},
	);

	/**
	 * Retrieves the given blob from the repository
	 */
	router.get(
		"/repos/:ignored?/:tenantId/git/blobs/:sha",
		utils.validateRequestParams("tenantId", "sha"),
		throttle(restTenantGeneralThrottler, winston, tenantThrottleOptions),
		utils.verifyTokenNotRevoked(tokenRevocationManager),
		(request, response, next) => {
			const useCache = !("disableCache" in request.query);
			const blobP = getBlob(
				request.params.tenantId,
				request.get("Authorization"),
				request.params.sha,
				useCache,
			);
			utils.handleResponse(blobP, response, useCache);
		},
	);

	/**
	 * Retrieves the given blob as an image
	 */
	router.get(
		"/repos/:ignored?/:tenantId/git/blobs/raw/:sha",
		utils.validateRequestParams("tenantId", "sha"),
		throttle(restTenantGeneralThrottler, winston, tenantThrottleOptions),
		utils.verifyTokenNotRevoked(tokenRevocationManager),
		(request, response, next) => {
			const useCache = !("disableCache" in request.query);

			const blobP = getBlob(
				request.params.tenantId,
				request.get("Authorization"),
				request.params.sha,
				useCache,
			);

			blobP.then(
				(blob) => {
					if (useCache) {
						response.setHeader("Cache-Control", "public, max-age=31535997");
					}
					if (!response.getHeader("access-control-expose-headers")) {
						response.setHeader(
							"access-control-expose-headers",
							"content-encoding, content-length, content-type",
						);
					}
					if (!response.getHeader("timing-allow-origin")) {
						response.setHeader("timing-allow-origin", "*");
					}
					const stream = Buffer.from(blob.content, "base64");
					response.status(200).write(stream, () => {
						Lumberjack.info(`Nichoc content ${stream.length}`);
						response.setHeader("content-length", stream.length);
						response.end();
					});
				},
				(error) => {
					response.status(error?.code ?? 400).json(error?.message ?? error);
				},
			);
		},
	);

	return router;
}
