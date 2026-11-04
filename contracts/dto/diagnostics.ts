/** Pure cross-process contracts. Runtime and renderer state belong to their owners. */

export type WorkbenchImageRequest=Record<string,never>;

export type WorkbenchImageResult={status:'saved';path:string;width:number;height:number;bytes:number;sha256:string;geometry:{before:{width:number;height:number;displayScale:number;zoomFactor:number};after:{width:number;height:number;displayScale:number;zoomFactor:number};nativeImage1xSize:{width:number;height:number};availableScaleFactors:number[];requestedPngScaleFactor:1}}|{status:'cancelled'}|null;
