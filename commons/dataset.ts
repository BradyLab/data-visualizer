// Shared dataset types used by both the frontend and backend

// Plot types a dataset can offer; values are the display labels (also stored in the DB enum)
export enum DatasetPlots {
    UMAP = "UMAP",
    DOT = "DotPlot",
    TISSUE = "TissuePlot",
    PCA = "PCA",
    VIOLIN = "ViolinPlot",
    HEATMAP = "Heatmap",
}

// Whether a dataset is listed publicly or only for permitted users (stored in the DB enum)
export enum DatasetVisibility {
    PUBLIC = "PUBLIC",
    PRIVATE = "PRIVATE",
}

// A dataset record as stored in the Datasets table
export interface IDataset {
    id: string;
    name: string;
    owner: string;
    url: string;
    description: string;
    doi: string;
    rawDataLink: string;
    treatments: string[];
    plots: DatasetPlots[];
    visibility: DatasetVisibility;
    createdAt: Date;
    updatedAt: Date | null;
}
