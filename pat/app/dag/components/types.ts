export type NodeData = {
  id: string;
  title: string;
  description?: string;
  score?: number;
  tags?: string[];
};

export type EdgeData = {
  id: string;
  source: string;
  target: string;
};

export type DagNode = NodeData & {
  x: number;
  y: number;
};

export type DagEdge = EdgeData;

export type Viewport = {
  x: number;
  y: number;
  zoom: number;
};

