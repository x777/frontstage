export interface JobStatus {
  status: "queued" | "running" | "succeeded" | "failed";
  resultUrls?: string[];
  errorMessage?: string;
}

export interface GenJobGateway {
  submitJob(modelEndpoint: string, input: Record<string, unknown>): Promise<{ jobId: string }>;
  jobStatus(modelEndpoint: string, jobId: string): Promise<JobStatus>;
  downloadResult(url: string): Promise<Uint8Array>;
  hasKey(): Promise<boolean>;
}
