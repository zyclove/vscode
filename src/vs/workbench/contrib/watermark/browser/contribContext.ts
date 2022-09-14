/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { KeybindingLabel } from 'vs/base/browser/ui/keybindingLabel/keybindingLabel';
import * as lifecycle from 'vs/base/common/lifecycle';
import { isMacintosh, isWeb, OS } from 'vs/base/common/platform';
import { CommandsRegistry } from 'vs/platform/commands/common/commands';
import { attachKeybindingLabelStyler } from 'vs/platform/theme/common/styler';
import { IContribContext } from 'vs/workbench/contrib/watermark/browser/contribContextInterface';
import * as types from 'vs/base/common/types';
import * as dom from 'vs/base/browser/dom';

export const contribContext: IContribContext = {
	base: {
		dom,
		lifecycle,
		platform: {
			commands: {
				CommandsRegistry
			},
			isMacintosh,
			isWeb,
			OS,
			theme: {
				styler: {
					attachKeybindingLabelStyler
				}
			}
		},
		types,
		ui: {
			keybindingLabel: {
				KeybindingLabel
			}
		}
	}
};
