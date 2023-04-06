/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EditorContributionInstantiation, registerEditorContribution } from 'vs/editor/browser/editorExtensions';
import { InlineCompletionController } from 'vs/editor/contrib/inlineCompletions/browser/inlineCompletionsController';

registerEditorContribution(InlineCompletionController.ID, InlineCompletionController, EditorContributionInstantiation.Eventually);
