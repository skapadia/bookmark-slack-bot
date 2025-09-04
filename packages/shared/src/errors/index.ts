export class BookmarkError extends Error {
  public readonly code: string;
  public readonly statusCode: number | undefined;

  constructor(message: string, code: string, statusCode?: number) {
    super(message);
    this.name = 'BookmarkError';
    this.code = code;
    this.statusCode = statusCode;
    Error.captureStackTrace(this, BookmarkError);
  }
}

export class ValidationError extends BookmarkError {
  public readonly field: string | undefined;

  constructor(message: string, field?: string) {
    super(message, 'VALIDATION_ERROR', 400);
    this.name = 'ValidationError';
    this.field = field;
  }
}

export class NotFoundError extends BookmarkError {
  constructor(message: string = 'Resource not found') {
    super(message, 'NOT_FOUND', 404);
    this.name = 'NotFoundError';
  }
}

export class DatabaseError extends BookmarkError {
  constructor(message: string) {
    super(message, 'DATABASE_ERROR', 500);
    this.name = 'DatabaseError';
  }
}

export class ExternalServiceError extends BookmarkError {
  public readonly service: string;

  constructor(message: string, service: string) {
    super(message, 'EXTERNAL_SERVICE_ERROR', 502);
    this.name = 'ExternalServiceError';
    this.service = service;
  }
}

export class SlackError extends ExternalServiceError {
  constructor(message: string) {
    super(message, 'slack');
    this.name = 'SlackError';
  }
}

export class BedrockError extends ExternalServiceError {
  constructor(message: string) {
    super(message, 'bedrock');
    this.name = 'BedrockError';
  }
}

export class LambdaError extends ExternalServiceError {
  constructor(message: string) {
    super(message, 'lambda');
    this.name = 'LambdaError';
  }
}