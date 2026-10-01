// Shared dataset types used by both the frontend and backend

// Plot types a dataset can offer; values are the display labels (also stored in the DB enum)
export enum DatasetPlots {
  UMAP = "UMAP",
  DOT = "Dot Plot",
  TISSUE = "Tissue Plot",
  PCA = "PCA",
  VIOLIN = "Violin Plot",
  HEATMAP = "Heatmap",
  // CONCHIE?
}

// A dataset record as stored in the Datasets table
export interface IDataset {
  id: string;
  name: string;
  owner: string;
  url: string;
  description: string;
  doi?: string | undefined;
  rawDataLink?: string | undefined;
  treatments: string[];
  plots: DatasetPlots[];
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date;
}
