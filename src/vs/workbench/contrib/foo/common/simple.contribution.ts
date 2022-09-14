/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from 'vs/base/common/event';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { createDecorator, IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { Registry } from 'vs/platform/registry/common/platform';
import { Extensions as WorkbenchExtensions, IWorkbenchContributionsRegistry } from 'vs/workbench/common/contributions';
import { ISimpleService } from 'vs/workbench/contrib/foo/common/simple';
import { IServiceFetcher } from 'vs/workbench/contrib/foo/common/util';
import { LifecyclePhase } from 'vs/workbench/services/lifecycle/common/lifecycle';



//
// Workbench contributions
//

class AsyncSimpleWorkbenchContribution {
	constructor(
		@IInstantiationService instantiationService: IInstantiationService
	) {
		// Types of the imported file are pulled in correctly
		import('vs/workbench/contrib/foo/common/simpleWorkbenchContribution').then(e => {
			instantiationService.createInstance(e.SimpleContribution, { EmitterCtor: Emitter });
		});
	}
}

// TODO: Provide registerAsyncWorkbenchContribution convenience method
Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench)
	.registerWorkbenchContribution(AsyncSimpleWorkbenchContribution, 'SimpleWorkbenchContribution', LifecyclePhase.Restored);



//
// Services
//

interface ISimpleServiceFetcher extends IServiceFetcher<ISimpleService> { }
class SimpleServiceFetcher implements ISimpleServiceFetcher {
	_serviceBrand: undefined;
	private _service?: Promise<ISimpleService>;
	get service(): Promise<ISimpleService> {
		if (!this._service) {
			this._service = import('vs/workbench/contrib/foo/common/simpleService').then(e => this._instantiationService.createInstance(e.SimpleService));
		}
		return this._service;
	}
	constructor(@IInstantiationService private readonly _instantiationService: IInstantiationService) { }
}

export const ISimpleServiceFetcher = createDecorator<ISimpleServiceFetcher>('simpleServiceFetcher');
registerSingleton(ISimpleServiceFetcher, SimpleServiceFetcher, true);

// Use the async service in a regular bundled contribution
class RegularWorkbenchContribution {
	constructor(
		@ISimpleServiceFetcher simpleServiceFetcher: ISimpleServiceFetcher
	) {
		simpleServiceFetcher.service.then(e => e.bar());
	}
}

Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench)
	.registerWorkbenchContribution(RegularWorkbenchContribution, 'RegularWorkbenchContribution', LifecyclePhase.Restored);
