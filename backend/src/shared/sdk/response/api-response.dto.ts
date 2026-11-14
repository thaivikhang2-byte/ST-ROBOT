// ═══════════════════════════════════════════
// Response SDK — API Response DTOs
// Standard response shape for all endpoints
// ═══════════════════════════════════════════

export class ApiResponse<T> {
  success: boolean;
  message: string;
  data: T;
  meta: ResponseMeta;

  constructor(data: T, message = 'Success', meta?: Partial<ResponseMeta>) {
    this.success = true;
    this.message = message;
    this.data = data;
    this.meta = {
      timestamp: new Date().toISOString(),
      ...meta,
    };
  }

  static ok<T>(data: T, message = 'Success'): ApiResponse<T> {
    return new ApiResponse(data, message);
  }

  static created<T>(data: T, message = 'Created successfully'): ApiResponse<T> {
    return new ApiResponse(data, message);
  }
}

export interface ApiErrorResponse {
  success: false;
  message: string;
  error: {
    code: string;
    type: string;
    details: unknown;
  };
  meta: ResponseMeta;
}

export interface ResponseMeta {
  timestamp: string;
  requestId?: string;
  pagination?: PaginationMeta;
  sort?: SortMeta;
  [key: string]: unknown;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface SortMeta {
  field: string;
  order: 'asc' | 'desc';
}
