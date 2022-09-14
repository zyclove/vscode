/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { Extensions as ConfigurationExtensions, IConfigurationRegistry } from 'vs/platform/configuration/common/configurationRegistry';
import { Registry } from 'vs/platform/registry/common/platform';
import { workbenchConfigurationNodeBase } from 'vs/workbench/common/configuration';
import { Extensions as WorkbenchExtensions, IWorkbenchContributionsRegistry } from 'vs/workbench/common/contributions';
import { LifecyclePhase } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { contribContext } from 'vs/workbench/contrib/watermark/browser/contribContext';

// Can't use helper as it has a required arg:
// Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench)
// 	.registerAsyncWorkbenchContribution(import('vs/workbench/contrib/watermark/browser/watermarkContribution').then(e => e.WatermarkContribution), 'WatermarkContribution', LifecyclePhase.Restored);

class AsyncWatermarkContribution {
	constructor(
		@IInstantiationService instantiationService: IInstantiationService
	) {
		// Types of the imported file are pulled in correctly
		import('vs/workbench/contrib/watermark/browser/watermarkContribution').then(e => {
			instantiationService.createInstance(e.WatermarkContribution, contribContext);
		});
	}
}

Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench)
	.registerWorkbenchContribution(AsyncWatermarkContribution, 'WatermarkContribution', LifecyclePhase.Restored);


Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration)
	.registerConfiguration({
		...workbenchConfigurationNodeBase,
		'properties': {
			'workbench.tips.enabled': {
				'type': 'boolean',
				'default': true,
				'description': nls.localize('tips.enabled', "When enabled, will show the watermark tips when no editor is open.")
			},
		}
	});
