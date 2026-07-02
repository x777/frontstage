export interface JobStatus {
  status: "queued" | "running" | "succeeded" | "failed";
  resultUrls?: string[];
  errorMessage?: string;
  // The raw succeeded-status result payload — orchestrators that read the JSON directly
  // (transcription: the transcript IS the result, not a downloadable URL) consume this instead
  // of resultUrls/downloadResult.
  resultJson?: unknown;
}

export interface GenJobGateway {
  submitJob(modelEndpoint: string, input: Record<string, unknown>): Promise<{ jobId: string }>;
  jobStatus(modelEndpoint: string, jobId: string): Promise<JobStatus>;
  downloadResult(url: string): Promise<Uint8Array>;
  // Uploads bytes to fal storage; returns a fal-fetchable URL for use as an *_url generation input.
  uploadFile(bytes: Uint8Array, contentType: string, fileName: string): Promise<string>;
  hasKey(): Promise<boolean>;
}
