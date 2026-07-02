export interface JobStatus {
  status: "queued" | "running" | "succeeded" | "failed";
  resultUrls?: string[];
  errorMessage?: string;
}

export interface GenJobGateway {
  submitJob(modelEndpoint: string, input: Record<string, unknown>): Promise<{ jobId: string }>;
  jobStatus(modelEndpoint: string, jobId: string): Promise<JobStatus>;
  downloadResult(url: string): Promise<Uint8Array>;
  // Uploads bytes to fal storage; returns a fal-fetchable URL for use as an *_url generation input.
  uploadFile(bytes: Uint8Array, contentType: string, fileName: string): Promise<string>;
  hasKey(): Promise<boolean>;
}
