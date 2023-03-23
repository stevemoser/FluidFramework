## API Report File for "@fluidframework/web-code-loader"

> Do not edit this file. It is a report generated by [API Extractor](https://api-extractor.com/).

```ts

import { ICodeAllowList } from '@fluidframework/container-definitions';
import { ICodeDetailsLoader } from '@fluidframework/container-definitions';
import { IFluidCodeDetails } from '@fluidframework/container-definitions';
import { IFluidCodeResolver } from '@fluidframework/container-definitions';
import { IFluidModuleWithDetails } from '@fluidframework/container-definitions';
import { IFluidPackage } from '@fluidframework/container-definitions';
import { IFluidPackageEnvironment } from '@fluidframework/container-definitions';
import { IResolvedFluidCodeDetails } from '@fluidframework/container-definitions';

// @public @deprecated
export class AllowList implements ICodeAllowList {
    // @deprecated
    constructor(testHandler?: ((source: IResolvedFluidCodeDetails) => Promise<boolean>) | undefined);
    // @deprecated (undocumented)
    testSource(source: IResolvedFluidCodeDetails): Promise<boolean>;
}

// @public @deprecated (undocumented)
export function extractPackageIdentifierDetails(codeDetailsPackage: string | IFluidPackage): IPackageIdentifierDetails;

// @public @deprecated (undocumented)
export interface IPackageIdentifierDetails {
    // @deprecated (undocumented)
    readonly fullId: string;
    // @deprecated (undocumented)
    readonly name: string;
    // @deprecated (undocumented)
    readonly nameAndVersion: string;
    // @deprecated (undocumented)
    readonly scope: string;
    // @deprecated (undocumented)
    readonly version: string | undefined;
}

// @public @deprecated (undocumented)
export function resolveFluidPackageEnvironment(environment: IFluidPackageEnvironment, baseUrl: string): Readonly<IFluidPackageEnvironment>;

// @public @deprecated
export class SemVerCdnCodeResolver implements IFluidCodeResolver {
    // @deprecated (undocumented)
    resolveCodeDetails(codeDetails: IFluidCodeDetails): Promise<IResolvedFluidCodeDetails>;
}

// @public @deprecated (undocumented)
export class WebCodeLoader implements ICodeDetailsLoader {
    // @deprecated
    constructor(codeResolver: IFluidCodeResolver, allowList?: ICodeAllowList | undefined);
    // @deprecated (undocumented)
    load(source: IFluidCodeDetails): Promise<IFluidModuleWithDetails>;
    // @deprecated (undocumented)
    preCache(source: IFluidCodeDetails): Promise<void>;
    // @deprecated (undocumented)
    seedModule(source: IFluidCodeDetails, maybeFluidModule?: Promise<IFluidModuleWithDetails> | IFluidModuleWithDetails): Promise<void>;
}

// (No @packageDocumentation comment for this package)

```