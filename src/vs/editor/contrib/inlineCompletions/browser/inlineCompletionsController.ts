/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { constObservable, observableValue } from 'vs/base/common/observable';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { ITextModel } from 'vs/editor/common/model';
import { GhostText, GhostTextPart, GhostTextReplacement } from 'vs/editor/contrib/inlineCompletions/browser/ghostText';
import { GhostTextWidget } from 'vs/editor/contrib/inlineCompletions/browser/ghostTextWidget';
import { SuggestController } from 'vs/editor/contrib/suggest/browser/suggestController';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';

export class InlineCompletionController extends Disposable {
	static ID = 'editor.contrib.inlineCompletionController';

	public static get(editor: ICodeEditor): InlineCompletionController | null {
		return editor.getContribution<InlineCompletionController>(InlineCompletionController.ID);
	}

	private readonly ghostText = observableValue<GhostText | GhostTextReplacement | undefined>('ghostText', new GhostText(2, [
		new GhostTextPart(1, ['hello', 'welt'], false)
	], 0));
	private readonly targetTextModel = observableValue<ITextModel | undefined>('ghostText', undefined);

	private ghostTextWidget = this.instantiationService.createInstance(GhostTextWidget, this.editor, {
		ghostText: this.ghostText,
		minReservedLineCount: constObservable(0),
		targetTextModel: this.targetTextModel,
	});

	constructor(
		public readonly editor: ICodeEditor,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
	) {
		super();

		const suggestController = SuggestController.get(this.editor);

		this.targetTextModel.set(editor.getModel() ?? undefined, undefined);
		editor.onDidChangeModel(e => {
			this.targetTextModel.set(editor.getModel()!, undefined);
		});


	}


}
