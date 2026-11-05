export interface ChartPoint {x:number|null;y:number|null;rowIndex:number;sourceLine:number}

export interface ChartData {rows:{rowIndex:number;sourceLine:number;values:(number|null)[]}[];series:{column:number;name:string;points:ChartPoint[]}[];xColumn:number|null;xLabel:string|null;ignoredColumns:{index:number;name:string}[];cutLines:boolean;cutColumns:boolean;skippedRows:number;missingValues:number;hasData:boolean;neb:boolean;structure:boolean}

export function parseChartData(text:string,name:string):ChartData;
