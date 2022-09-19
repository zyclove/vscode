/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Copyright (c) 2017 The xterm.js authors. All rights reserved.
 * @license MIT
 */

import { IColorSet } from 'vs/editor/browser/viewParts/lines/webgl/base/Types';

export interface IGlyphIdentifier {
	chars: string;
	code: number;
	bg: number;
	fg: number;
	bold: boolean;
	dim: boolean;
	italic: boolean;
}

export interface ICharAtlasConfig {
	customGlyphs: boolean;
	devicePixelRatio: number;
	letterSpacing: number;
	lineHeight: number;
	fontSize: number;
	fontFamily: string;
	fontWeight: FontWeight;
	fontWeightBold: FontWeight;
	scaledCellWidth: number;
	scaledCellHeight: number;
	scaledCharWidth: number;
	scaledCharHeight: number;
	allowTransparency: boolean;
	drawBoldTextInBrightColors: boolean;
	minimumContrastRatio: number;
	colors: IColorSet;
}

export type FontWeight = 'normal' | 'bold' | '100' | '200' | '300' | '400' | '500' | '600' | '700' | '800' | '900' | number;
