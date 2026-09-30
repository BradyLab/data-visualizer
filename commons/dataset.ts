export enum DatasetPlots {
    UMAP = "UMAP",
    DOT = "Dot Plot",
    TISSUE = "Tissue Plot",
    PCA = "PCA",
    VIOLIN = "Violin Plot",
    HEATMAP = "Heatmap",
    // CONCHIE?
}

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
