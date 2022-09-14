/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { createDecorator, IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { Registry } from 'vs/platform/registry/common/platform';
import { Extensions as WorkbenchExtensions, IWorkbenchContributionsRegistry } from 'vs/workbench/common/contributions';
import { ISharedBundleService } from 'vs/workbench/contrib/foo/common/sharedBundle';
import { IServiceFetcher } from 'vs/workbench/contrib/foo/common/util';
import { LifecyclePhase } from 'vs/workbench/services/lifecycle/common/lifecycle';



//
// Single shared bundle for both a contrib and a service
//

let sharedBundleModulePromise: Promise<typeof import('vs/workbench/contrib/foo/common/sharedBundleMain')>;
function loadSharedBundleModule(): Promise<typeof import('vs/workbench/contrib/foo/common/sharedBundleMain')> {
	if (!sharedBundleModulePromise) {
		sharedBundleModulePromise = import('vs/workbench/contrib/foo/common/sharedBundleMain');
	}
	return sharedBundleModulePromise;
}

interface ISharedBundleServiceFetcher extends IServiceFetcher<ISharedBundleService> { }
class SharedBundleServiceFetcher implements ISharedBundleServiceFetcher {
	_serviceBrand: undefined;

	private _service?: Promise<ISharedBundleService>;
	get service(): Promise<ISharedBundleService> {
		if (!this._service) {
			this._service = loadSharedBundleModule().then(e => this._instantiationService.createInstance(e.SharedBundleService));
		}
		return this._service;
	}

	constructor(@IInstantiationService private readonly _instantiationService: IInstantiationService) { }
}

export const ISharedBundleServiceFetcher = createDecorator<ISharedBundleServiceFetcher>('sharedBundleServiceFetcher');
registerSingleton(ISharedBundleServiceFetcher, SharedBundleServiceFetcher, true);

class AsyncSharedBundleWorkbenchContribution {
	constructor(
		@IInstantiationService instantiationService: IInstantiationService
	) {
		loadSharedBundleModule().then(e => {
			instantiationService.createInstance(e.SharedBundleContribution);
		});
	}
}

// TODO: Provide registerAsyncWorkbenchContribution convenience method
Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench)
	.registerWorkbenchContribution(AsyncSharedBundleWorkbenchContribution, 'SharedBundleWorkbenchContribution', LifecyclePhase.Restored);
