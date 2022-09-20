/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Copyright (c) 2018 The xterm.js authors. All rights reserved.
 * @license MIT
 */

import { Disposable, toDisposable } from 'vs/base/common/lifecycle';
import { IRenderDimensions } from 'vs/editor/browser/viewParts/lines/webgl/base/Types';
import { EditorOption, IRulerOption } from 'vs/editor/common/config/editorOptions';
import { editorRuler } from 'vs/editor/common/core/editorColorRegistry';
import * as viewEvents from 'vs/editor/common/viewEvents';
import { ViewContext } from 'vs/editor/common/viewModel/viewContext';
import { IWebGL2RenderingContext, IWebGLVertexArrayObject } from './Types';
import { createProgram, PROJECTION_MATRIX, throwIfFalsy } from './WebglUtils';

const enum VertexAttribLocations {
	POSITION = 0,
	COLOR = 1,
	UNIT_QUAD = 2
}

const vertexShaderSource = `#version 300 es
layout (location = ${VertexAttribLocations.POSITION}) in float a_position;
layout (location = ${VertexAttribLocations.COLOR}) in vec4 a_color;
layout (location = ${VertexAttribLocations.UNIT_QUAD}) in vec2 a_unitquad;

uniform mat4 u_projection;
uniform vec2 u_size;

out vec4 v_color;

void main() {
	vec2 zeroToOne = vec2(a_position, 0) + (a_unitquad * u_size);
	gl_Position = u_projection * vec4(zeroToOne, 0.0, 1.0);
	v_color = a_color;
}`;

const fragmentShaderSource = `#version 300 es
precision lowp float;

in vec4 v_color;

out vec4 outColor;

void main() {
	outColor = v_color;
}`;

interface IVertices {
	attributes: Float32Array;
	count: number;
}

const INDICES_PER_ITEM = 5;
const BYTES_PER_ITEM = INDICES_PER_ITEM * Float32Array.BYTES_PER_ELEMENT;
const INITIAL_ITEM_CAPACITY = 0 * INDICES_PER_ITEM;

export class RulerRenderer extends Disposable {

	private _program: WebGLProgram;
	private _vertexArrayObject: IWebGLVertexArrayObject;
	private _attributesBuffer: WebGLBuffer;
	private _projectionLocation: WebGLUniformLocation;
	private _sizeLocation: WebGLUniformLocation;

	private _rulers!: IRulerOption[];
	private _typicalHalfwidthCharacterWidth!: number;

	private _vertices: IVertices = {
		count: INITIAL_ITEM_CAPACITY,
		attributes: new Float32Array(INITIAL_ITEM_CAPACITY * INDICES_PER_ITEM)
	};
	private _bgFloat: Float32Array = new Float32Array([0, 0, 0, 0]);

	constructor(
		private readonly _context: ViewContext,
		private _gl: IWebGL2RenderingContext,
		private _dimensions: IRenderDimensions
	) {
		super();

		this._refreshRulers();

		const gl = this._gl;

		this._program = throwIfFalsy(createProgram(gl, vertexShaderSource, fragmentShaderSource));
		this._register(toDisposable(() => gl.deleteProgram(this._program)));

		// Uniform locations
		this._projectionLocation = throwIfFalsy(gl.getUniformLocation(this._program, 'u_projection'));
		this._sizeLocation = throwIfFalsy(gl.getUniformLocation(this._program, 'u_size'));

		// Create and set the vertex array object
		this._vertexArrayObject = gl.createVertexArray();
		gl.bindVertexArray(this._vertexArrayObject);

		// Setup a_unitquad, this defines the 4 vertices of a rectangle
		const unitQuadVertices = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]);
		const unitQuadVerticesBuffer = gl.createBuffer();
		this._register(toDisposable(() => gl.deleteBuffer(unitQuadVerticesBuffer)));
		gl.bindBuffer(gl.ARRAY_BUFFER, unitQuadVerticesBuffer);
		gl.bufferData(gl.ARRAY_BUFFER, unitQuadVertices, gl.STATIC_DRAW);
		gl.enableVertexAttribArray(VertexAttribLocations.UNIT_QUAD);
		gl.vertexAttribPointer(VertexAttribLocations.UNIT_QUAD, 2, this._gl.FLOAT, false, 0, 0);

		// Setup the unit quad element array buffer, this points to indices in
		// unitQuadVertices to allow is to draw 2 triangles from the vertices
		const unitQuadElementIndices = new Uint8Array([0, 1, 3, 0, 2, 3]);
		const elementIndicesBuffer = gl.createBuffer();
		this._register(toDisposable(() => gl.deleteBuffer(elementIndicesBuffer)));
		gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, elementIndicesBuffer);
		gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, unitQuadElementIndices, gl.STATIC_DRAW);

		// Setup attributes
		this._attributesBuffer = throwIfFalsy(gl.createBuffer());
		this._register(toDisposable(() => gl.deleteBuffer(this._attributesBuffer)));
		gl.bindBuffer(gl.ARRAY_BUFFER, this._attributesBuffer);
		gl.enableVertexAttribArray(VertexAttribLocations.POSITION);
		gl.vertexAttribPointer(VertexAttribLocations.POSITION, 1, gl.FLOAT, false, BYTES_PER_ITEM, 0);
		gl.vertexAttribDivisor(VertexAttribLocations.POSITION, 1);
		gl.enableVertexAttribArray(VertexAttribLocations.COLOR);
		gl.vertexAttribPointer(VertexAttribLocations.COLOR, 4, gl.FLOAT, false, BYTES_PER_ITEM, 1 * Float32Array.BYTES_PER_ELEMENT);
		gl.vertexAttribDivisor(VertexAttribLocations.COLOR, 1);

		this._updateCachedColors();
	}

	public onConfigurationChanged(e: viewEvents.ViewConfigurationChangedEvent): boolean {
		this._refreshRulers();
		return true;
	}

	private _refreshRulers(): void {
		const options = this._context.configuration.options;
		this._rulers = options.get(EditorOption.rulers);

		// TODO: This uses the old method for fetching char width
		this._typicalHalfwidthCharacterWidth = options.get(EditorOption.fontInfo).typicalHalfwidthCharacterWidth;
		if (this._rulers.length !== this._vertices.count) {
			this._vertices.count = this._rulers.length;
			this._vertices.attributes = new Float32Array(this._rulers.length * INDICES_PER_ITEM);
		}
	}

	public update(): void {
		for (let i = 0, len = this._rulers.length; i < len; i++) {
			const ruler = this._rulers[i];
			this._vertices.attributes[i * INDICES_PER_ITEM] = (ruler.column * this._typicalHalfwidthCharacterWidth) / this._dimensions.canvasWidth;
			this._vertices.attributes[i * INDICES_PER_ITEM + 1] = this._bgFloat[0];
			this._vertices.attributes[i * INDICES_PER_ITEM + 2] = this._bgFloat[1];
			this._vertices.attributes[i * INDICES_PER_ITEM + 3] = this._bgFloat[2];
			this._vertices.attributes[i * INDICES_PER_ITEM + 4] = this._bgFloat[3];
		}
	}

	public render(): void {
		const gl = this._gl;

		gl.useProgram(this._program);

		gl.bindVertexArray(this._vertexArrayObject);

		gl.uniformMatrix4fv(this._projectionLocation, false, PROJECTION_MATRIX);
		gl.uniform2f(this._sizeLocation, Math.round(window.devicePixelRatio) / this._dimensions.scaledCanvasWidth, 1);

		// Bind attributes buffer and draw
		gl.bindBuffer(gl.ARRAY_BUFFER, this._attributesBuffer);
		gl.bufferData(gl.ARRAY_BUFFER, this._vertices.attributes, gl.DYNAMIC_DRAW);
		gl.drawElementsInstanced(this._gl.TRIANGLES, 6, gl.UNSIGNED_BYTE, 0, this._vertices.count);
	}

	public onResize(): void {
	}

	public setColors(): void {
		this._updateCachedColors();
	}

	public setDimensions(dimensions: IRenderDimensions): void {
		this._dimensions = dimensions;
	}

	private _updateCachedColors(): void {
		const color = this._context.theme.getColor(editorRuler);
		if (color) {
			this._bgFloat[0] = color.rgba.r / 255;
			this._bgFloat[1] = color.rgba.g / 255;
			this._bgFloat[2] = color.rgba.b / 255;
			this._bgFloat[3] = color.rgba.a;
		}
	}
}
