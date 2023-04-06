/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { BugIndicatingError } from 'vs/base/common/errors';
import { Disposable, DisposableMap, IDisposable } from 'vs/base/common/lifecycle';
import { IObservable } from 'vs/base/common/observable';
import { Position } from 'vs/editor/common/core/position';
import { Range } from 'vs/editor/common/core/range';
import { InlineCompletionContext } from 'vs/editor/common/languages';
import { InlineCompletionTriggerKind } from 'vs/editor/common/languages';
import { ITextModel } from 'vs/editor/common/model';
import { InternalModelContentChangeEvent } from 'vs/editor/common/textModelEvents';
import { GhostText, GhostTextOrReplacement, GhostTextReplacement } from 'vs/editor/contrib/inlineCompletions/browser/ghostText';
import { InlineCompletionProviderResult, provideInlineCompletions } from 'vs/editor/contrib/inlineCompletions/browser/provideInlineCompletions';
import { InlineCompletionItem } from 'vs/editor/contrib/inlineCompletions/browser/provideInlineCompletions';

export class InlineCompletionModel {

	ghostTexts: IObservable<GhostTextOrReplacement[]>;
	inlineCompletionsCount: IObservable<number | 'loading'>;

	constructor() {

	}

	public showNext(): void {

	}

	public showPrevious(): void { }

	public accept(): void { }

	public acceptNextWord(): void { }

	public hide(): void { }

	public trigger(triggerKind: InlineCompletionTriggerKind): void { }
}


export class UpToDateInlineCompletions implements IDisposable {
	private lastVersionId: number = -1;
	private readonly inlineCompletions: readonly InlineCompletionWithUpdatedRange[];

	constructor(
		private readonly inlineCompletionProviderResult: InlineCompletionProviderResult,
		private readonly textModel: ITextModel
	) {
		const ids = textModel.deltaDecorations([], inlineCompletionProviderResult.completions.map(i => ({
			range: i.range,
			options: {
				description: 'inline-completion-tracking-range'
			},
		})));

		this.inlineCompletions = inlineCompletionProviderResult.completions.map(
			(i, index) => new InlineCompletionWithUpdatedRange(i, ids[index])
		);
	}

	public dispose(): void {
		this.textModel.deltaDecorations(this.inlineCompletions.map(i => i.decorationId), []);
		this.inlineCompletionProviderResult.dispose();
	}

	/**
	 * The ranges of the inline completions are extended as the user typed.
	 */
	public getInlineCompletions(): readonly InlineCompletionWithUpdatedRange[] {
		if (this.textModel.getVersionId() !== this.lastVersionId) {
			this.inlineCompletions.forEach(i => i.updateRange(this.textModel));
			this.lastVersionId = this.textModel.getVersionId();
		}
		return this.inlineCompletions;
	}
}

class InlineCompletionWithUpdatedRange {
	private _updatedRange: Range;
	public get updatedRange(): Range { return this._updatedRange; }

	constructor(
		public readonly inlineCompletion: InlineCompletionItem,
		public readonly decorationId: string,
	) {
		this._updatedRange = inlineCompletion.range;
	}

	public updateRange(textModel: ITextModel): void {
		const range = textModel.getDecorationRange(this.decorationId);
		if (!range) {
			throw new BugIndicatingError();
		}
		this._updatedRange = range;
	}
}

/**
 * typing a character (+moving cursor): Show ghost text
 * Moving cursor: Hide ghost text
*/

class InlineCompletionsSession extends Disposable {
	//public readonly currentInlineCompletion: IObservable<InlineCompletionItems>;

	private readonly inlineCompletionsUpdateOperation: any; // mutable disposable
	private inlineCompletions: UpToDateInlineCompletions | undefined;

	private readonly inlineCompletionsUpdateOperation: any; // mutable disposable
	private suggestWidgetInlineCompletions: UpToDateInlineCompletions | undefined;



	constructor(private readonly textModel: ITextModel) { }


	public scheduleUpdate(position: Position, context: InlineCompletionContext): void {
		const versionNumber = this.textModel.getVersionId();
	}

	private async update(position: Position, context: InlineCompletionContext): void {



		const result = await provideInlineCompletions();

		// check versionNumber
	}
}

export class UpdateOperation implements IDisposable {
	constructor(public readonly promise: CancelablePromise<void>, public readonly context: InlineCompletionContext) {
	}

	dispose() {
		this.promise.cancel();
	}
}
