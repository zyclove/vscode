/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { KeybindingLabel } from 'vs/base/browser/ui/keybindingLabel/keybindingLabel';
import type * as lifecycle from 'vs/base/common/lifecycle';
import type { isMacintosh, isWeb, OS } from 'vs/base/common/platform';
import type { CommandsRegistry } from 'vs/platform/commands/common/commands';
import type { attachKeybindingLabelStyler } from 'vs/platform/theme/common/styler';
import type * as types from 'vs/base/common/types';
import type * as dom from 'vs/base/browser/dom';

export interface IContribContext {
	base: {
		dom: typeof dom,
		lifecycle: typeof lifecycle,
		platform: {
			commands: {
				CommandsRegistry: typeof CommandsRegistry
			},
			isMacintosh: typeof isMacintosh,
			isWeb: typeof isWeb,
			OS: typeof OS,
			theme: {
				styler: {
					attachKeybindingLabelStyler: typeof attachKeybindingLabelStyler
				}
			}
		},
		types: typeof types,
		ui: {
			keybindingLabel: {
				KeybindingLabel: typeof KeybindingLabel
			}
		}
	}
}
