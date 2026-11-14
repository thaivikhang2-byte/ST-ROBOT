import { ForbiddenException, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { AiAgentMode } from '@prisma/client';

export type RagSecurityClassification = 'PUBLIC' | 'INTERNAL_STAFF' | 'ADMIN_ONLY';

export interface RagDocumentMetadata {
  sourceId: string;
  title: string;
  version: string;
  classification: RagSecurityClassification;
  resourceScope: 'GLOBAL' | 'SYSTEM' | 'COURSE';
  requiredPermissions: readonly string[];
  allowedModes: readonly AiAgentMode[];
  updatedAt: string;
}

export interface RagChunk {
  chunkId: string;
  sourceId: string;
  index: number;
  text: string;
  tokens: string[];
  embedding: number[];
}

export interface RagRetrievedCitation {
  sourceId: string;
  chunkId: string;
  title: string;
  version: string;
  classification: RagSecurityClassification;
  resourceScope: string;
  updatedAt: string;
  score: number;
  excerpt: string;
}

const FORBIDDEN_SECRET_PATTERNS =
  /(?:-----BEGIN [A-Z ]+PRIVATE KEY-----|sk-[A-Za-z0-9]{16,}|AI_CREDENTIALS_MASTER_KEY\s*=\s*\S+|password_hash|ciphertext|refresh_token)/i;

const PROMPT_INJECTION_PATTERNS =
  /(?:ignore\s+(?:all\s+)?(?:previous|prior|system)\s+instructions|bỏ\s+qua\s+(?:mọi\s+)?chỉ\s+thị\s+hệ\s+thống|system\s*override|bypass\s+rbac|reveal\s+api\s+key|tiết\s+lộ\s+khóa\s+api)/gi;

const EMBEDDING_DIM = 128;

const VIETNAMESE_SYNONYM_GROUPS: readonly (readonly string[])[] = [
  ['teacher', 'giang', 'vien', 'giao', 'day', 'instructor'],
  ['approval', 'phe', 'duyet', 'duyet', 'application', 'ho', 'so', 'yeu', 'cau', 'request'],
  ['course', 'khoa', 'hoc', 'bai', 'giang', 'lesson', 'publish', 'xuat', 'ban', 'draft', 'nhap'],
  ['provider', 'openrouter', 'cloudflare', 'workers', 'openai', 'anthropic', 'gemini', 'model'],
  ['retry', 'failover', 'circuit', 'breaker', '503', '429', 'timeout', 'loi', 'du', 'phong'],
  ['cache', 'caching', 'semantic', 'redis', 'bo', 'nho', 'dem'],
  ['rbac', 'quyen', 'permission', 'role', 'vai', 'tro', 'scope', 'pham', 'vi', 'manager', 'admin'],
  ['kill', 'switch', 'writes', 'action', 'xac', 'nhan', 'confirm', 'confirmation'],
  ['quota', 'cost', 'chi', 'phi', 'budget', 'ngan', 'sach', 'token', 'usage'],
  ['security', 'bao', 'mat', 'vault', 'injection', 'audit', 'nhat', 'ky'],
];

export function normalizeVietnameseText(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9@._:/-\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function computeSemanticEmbedding(text: string): number[] {
  const vector = new Array<number>(EMBEDDING_DIM).fill(0);
  const normalized = normalizeVietnameseText(text);
  const words = normalized.split(' ').filter((w) => w.length >= 2);
  if (!words.length) return vector;

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const h1 = createHash('md5').update(`w:${word}`).digest();
    const idx1 = h1[0] % EMBEDDING_DIM;
    const sign1 = h1[1] % 2 === 0 ? 1 : -1;
    vector[idx1] += sign1 * 1.5;

    // Character trigrams for morphological resilience
    for (let c = 0; c <= word.length - 3; c++) {
      const tri = word.slice(c, c + 3);
      const ht = createHash('md5').update(`t:${tri}`).digest();
      const idxt = ht[0] % EMBEDDING_DIM;
      vector[idxt] += (ht[1] % 2 === 0 ? 1 : -1) * 0.4;
    }

    // Word bigrams for phrase order sensitivity
    if (i + 1 < words.length) {
      const bi = `${word}_${words[i + 1]}`;
      const hb = createHash('md5').update(`b:${bi}`).digest();
      const idxb = hb[0] % EMBEDDING_DIM;
      vector[idxb] += (hb[1] % 2 === 0 ? 1 : -1) * 1.0;
    }

    // Bilingual concept alignment
    for (let g = 0; g < VIETNAMESE_SYNONYM_GROUPS.length; g++) {
      if (VIETNAMESE_SYNONYM_GROUPS[g].includes(word)) {
        const conceptIdx = (g * 11 + 7) % EMBEDDING_DIM;
        vector[conceptIdx] += 2.2;
      }
    }
  }

  const norm = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
  if (norm > 0) {
    for (let i = 0; i < EMBEDDING_DIM; i++) {
      vector[i] = Number((vector[i] / norm).toFixed(6));
    }
  }
  return vector;
}

export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (!a.length || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

const BUILTIN_DOCUMENTS: Array<RagDocumentMetadata & { content: string }> = [
  {
    sourceId: 'doc-approval-policy',
    title: 'Chính sách Phê duyệt Giảng viên & Bổ nhiệm Quản lý (Approval Workflows)',
    version: '2026.11.1',
    classification: 'INTERNAL_STAFF',
    resourceScope: 'SYSTEM',
    requiredPermissions: ['system:read'],
    allowedModes: ['MANAGEMENT'],
    updatedAt: '2026-11-10T00:00:00.000Z',
    content: `Quy trình phê duyệt trong ST-Robot áp dụng kiểm soát phân quyền động (Dynamic RBAC):
1. Hồ sơ đăng ký Giảng viên (TEACHER_APPLICATION) và yêu cầu phân quyền khóa học được gửi vào Trung tâm Phê duyệt (Approval Center).
2. Quản trị viên có quyền approvals:manage xem xét và phê duyệt. AI không bao giờ được tự ý phê duyệt hoặc bổ nhiệm bất kỳ ai.
3. Chính sách bổ nhiệm Quản lý cấp cao (HIGH_PRIVILEGE_APPOINTMENT / MANAGER): Bắt buộc phải có sự đồng thuận của 2 người phê duyệt độc lập (Two-Independent-Approver Policy). Người đề xuất không được tự phê duyệt yêu cầu của chính mình.
4. Số lượng hồ sơ đang chờ thực tế phải được lấy qua công cụ management_get_pending_approvals từ Admin API.`,
  },
  {
    sourceId: 'doc-course-governance',
    title: 'Quy trình Quản lý & Xuất bản Khóa học (Course Governance)',
    version: '2026.11.1',
    classification: 'INTERNAL_STAFF',
    resourceScope: 'SYSTEM',
    requiredPermissions: ['courses:read'],
    allowedModes: ['MANAGEMENT', 'EDUCATIONAL'],
    updatedAt: '2026-11-10T00:00:00.000Z',
    content: `Quy định quản lý khóa học trên ST-Robot:
1. Khóa học mới được khởi tạo ở trạng thái bản nháp (draft).
2. Management AI có thể tạo đề xuất bản nháp khóa học (management_propose_course_draft), đề xuất cập nhật thông tin không nhạy cảm (management_update_course_info) hoặc đề xuất xuất bản khóa học (management_propose_course_publish).
3. Điều kiện bắt buộc để xuất bản khóa học (status = published): Khóa học phải có tiêu đề, mô tả hợp lệ, người tạo đang hoạt động (is_active), danh mục hợp lệ và ít nhất một bài học (lesson) đã xuất bản có nội dung thực tế.
4. Mọi thao tác ghi từ AI đều phải được xác nhận rõ ràng trong Action Center với mã xác nhận tương ứng (CREATE_DRAFT, UPDATE_COURSE_INFO, PUBLISH_COURSE) và chỉ thực thi khi AI Write Kill Switch đang bật.`,
  },
  {
    sourceId: 'doc-ai-provider-resilience',
    title: 'Kiến trúc Đa nhà cung cấp AI, Retry 503 & Dự phòng (Multi-Provider Resilience)',
    version: '2026.11.1',
    classification: 'ADMIN_ONLY',
    resourceScope: 'SYSTEM',
    requiredPermissions: ['ai:manage'],
    allowedModes: ['MANAGEMENT'],
    updatedAt: '2026-11-10T00:00:00.000Z',
    content: `Hệ thống AI Gateway của ST-Robot hỗ trợ 6 loại adapter nhà cung cấp: OpenAI, Anthropic, Google Gemini, OpenRouter, Cloudflare Workers AI và OpenAI-Compatible.
1. Toàn bộ khóa API được mã hóa chuẩn AES-256-GCM trong Vault tuyệt đối không lộ ra trình duyệt.
2. Khi gặp lỗi tạm thời HTTP 503 hoặc 429, hệ thống kiểm tra header Retry-After, thời hạn yêu cầu (deadline) và thực hiện thử lại có giới hạn (Exponential Backoff with Jitter) tối đa theo cấu hình AI_MAX_APPLICATION_ATTEMPTS.
3. Nếu vẫn thất bại và model có cấu hình fallback_model_ids cùng privacyGroup, hệ thống tự động chuyển đổi dự phòng (Failover) sang model tương thích.
4. Circuit Breaker tự động chuyển sang trạng thái OPEN khi liên tiếp gặp lỗi 5xx/503 và thử phục hồi qua trạng thái HALF_OPEN.
5. Không bao giờ tự động chạy lại các thao tác ghi quản trị (mutations) khi gặp lỗi 503.`,
  },
  {
    sourceId: 'doc-ai-security-model-b',
    title: 'Chính sách Bảo mật AI Agent Model B & Kill Switch (AI Agent Security Policy)',
    version: '2026.11.1',
    classification: 'INTERNAL_STAFF',
    resourceScope: 'SYSTEM',
    requiredPermissions: ['system:read'],
    allowedModes: ['MANAGEMENT'],
    updatedAt: '2026-11-10T00:00:00.000Z',
    content: `ST-Robot áp dụng mô hình bảo mật AI Model B:
1. AI Agent chỉ được phép truy cập các công cụ nằm trong phạm vi quyền RBAC hiệu lực của người dùng đang đăng nhập.
2. Phân vùng hội thoại và bộ nhớ được cách ly nghiêm ngặt giữa PERSONAL, EDUCATIONAL và MANAGEMENT.
3. Công tắc khẩn cấp AI Write Kill Switch (ai_agent_controls.writes_enabled) mặc định ở trạng thái TẮT (false). Khi tắt, mọi công cụ đề xuất ghi R2 đều bị ẩn và từ chối thực thi tại máy chủ.
4. Mỗi đề xuất hành động gắn chặt với mã băm SHA-256 của nội dung xem trước (payload_hash) và khóa chống phát lại (idempotency) trong giao dịch cơ sở dữ liệu.`,
  },
  {
    sourceId: 'doc-operations-runbook',
    title: 'Sổ tay Vận hành, Giám sát & Sao lưu Hệ thống (Operations Runbook)',
    version: '2026.11.1',
    classification: 'ADMIN_ONLY',
    resourceScope: 'SYSTEM',
    requiredPermissions: ['system:read'],
    allowedModes: ['MANAGEMENT'],
    updatedAt: '2026-11-10T00:00:00.000Z',
    content: `Hướng dẫn vận hành và giám sát ST-Robot:
1. Sức khỏe hệ thống kiểm tra kết nối thực tế tới PostgreSQL, Redis, MinIO Storage và các hàng đợi xử lý nền (Bull queues).
2. Cảnh báo vận hành (Operational Alerts) ghi nhận khi tỷ lệ lỗi HTTP 5xx vượt ngưỡng, hàng đợi tồn đọng hoặc chi phí AI vượt ngân sách ngày.
3. Để xem cảnh báo trực tiếp hoặc tình trạng dịch vụ hiện tại, Management AI phải gọi công cụ management_get_operational_alerts hoặc admin_get_system_overview.`,
  },
  {
    sourceId: 'doc-stem-catalog-guide',
    title: 'Hướng dẫn Chương trình Học STEM & Robotics (Public Catalog Guide)',
    version: '2026.11.1',
    classification: 'PUBLIC',
    resourceScope: 'GLOBAL',
    requiredPermissions: [],
    allowedModes: ['PERSONAL', 'EDUCATIONAL', 'MANAGEMENT'],
    updatedAt: '2026-11-10T00:00:00.000Z',
    content: `Nền tảng ST-Robot cung cấp các khóa học STEM, lập trình vi điều khiển, cảm biến robotics và tự học thực hành. Học viên đã xác minh email có thể ghi danh khóa học, xem video bài giảng thích ứng, làm bài kiểm tra trắc nghiệm/tự luận và sử dụng Trợ lý AI Giảng dạy trong phạm vi bài học.`,
  },
];

@Injectable()
export class AiRagService {
  private readonly documents = new Map<string, RagDocumentMetadata>();
  private readonly chunks = new Map<string, RagChunk[]>();
  private knowledgeVersion = 1;

  constructor() {
    for (const doc of BUILTIN_DOCUMENTS) {
      this.ingestDocument(doc, doc.content);
    }
  }

  getKnowledgeVersion(): string {
    return `kb-v${this.knowledgeVersion}`;
  }

  ingestDocument(metadata: RagDocumentMetadata, rawContent: string): { chunkCount: number; knowledgeVersion: string } {
    if (FORBIDDEN_SECRET_PATTERNS.test(rawContent) || FORBIDDEN_SECRET_PATTERNS.test(metadata.title)) {
      throw new ForbiddenException(
        'RAG ingestion rejected: document contains restricted credentials, keys or secret patterns',
      );
    }
    const cleaned = this.sanitizeDocumentText(rawContent);
    const segments = this.chunkText(cleaned, 450);
    const builtChunks: RagChunk[] = segments.map((segment, index) => ({
      chunkId: `${metadata.sourceId}#chunk-${index + 1}`,
      sourceId: metadata.sourceId,
      index,
      text: segment,
      tokens: normalizeVietnameseText(`${metadata.title} ${segment}`)
        .split(' ')
        .filter((t) => t.length >= 2),
      embedding: computeSemanticEmbedding(`${metadata.title} ${segment}`),
    }));

    this.documents.set(metadata.sourceId, {
      ...metadata,
      updatedAt: metadata.updatedAt || new Date().toISOString(),
    });
    this.chunks.set(metadata.sourceId, builtChunks);
    this.knowledgeVersion += 1;
    return { chunkCount: builtChunks.length, knowledgeVersion: this.getKnowledgeVersion() };
  }

  removeDocument(sourceId: string): boolean {
    const existed = this.documents.delete(sourceId);
    this.chunks.delete(sourceId);
    if (existed) this.knowledgeVersion += 1;
    return existed;
  }

  listAuthorizedDocuments(options: {
    mode: AiAgentMode;
    permissions: readonly string[];
    isSystemManager: boolean;
  }): RagDocumentMetadata[] {
    const result: RagDocumentMetadata[] = [];
    for (const doc of this.documents.values()) {
      if (this.isDocumentAuthorized(doc, options)) {
        result.push(doc);
      }
    }
    return result;
  }

  private isDocumentAuthorized(
    doc: RagDocumentMetadata,
    options: {
      mode: AiAgentMode;
      permissions: readonly string[];
      isSystemManager: boolean;
    },
  ): boolean {
    if (!doc.allowedModes.includes(options.mode)) return false;
    if (doc.classification === 'ADMIN_ONLY' && !options.isSystemManager) return false;
    if (
      doc.classification === 'INTERNAL_STAFF' &&
      !options.isSystemManager &&
      options.mode !== 'MANAGEMENT'
    ) {
      return false;
    }
    if (
      doc.requiredPermissions.length > 0 &&
      !doc.requiredPermissions.every((perm) => options.permissions.includes(perm))
    ) {
      return false;
    }
    return true;
  }

  retrieve(
    query: string,
    options: {
      mode: AiAgentMode;
      permissions: readonly string[];
      isSystemManager: boolean;
      topK?: number;
      minScore?: number;
    },
  ): RagRetrievedCitation[] {
    const trimmed = query.trim();
    if (!trimmed) return [];
    const queryEmbedding = computeSemanticEmbedding(trimmed);
    const queryTokens = new Set(
      normalizeVietnameseText(trimmed)
        .split(' ')
        .filter((t) => t.length >= 2),
    );
    const topK = Math.min(Math.max(options.topK ?? 3, 1), 8);
    const minScore = options.minScore ?? 0.22;

    // Permission-aware filtering BEFORE scoring or returning any chunks
    const authorizedDocs = this.listAuthorizedDocuments(options);
    const scored: RagRetrievedCitation[] = [];

    for (const doc of authorizedDocs) {
      // Second permission recheck for sensitive classifications
      if (
        (doc.classification === 'ADMIN_ONLY' || doc.classification === 'INTERNAL_STAFF') &&
        !this.isDocumentAuthorized(doc, options)
      ) {
        continue;
      }
      const docChunks = this.chunks.get(doc.sourceId) ?? [];
      for (const chunk of docChunks) {
        const vectorScore = cosineSimilarity(queryEmbedding, chunk.embedding);
        let keywordMatches = 0;
        for (const token of queryTokens) {
          if (chunk.tokens.includes(token)) keywordMatches++;
        }
        const keywordScore = queryTokens.size > 0 ? keywordMatches / queryTokens.size : 0;
        const hybridScore = Number((vectorScore * 0.65 + keywordScore * 0.35).toFixed(4));
        if (hybridScore >= minScore) {
          scored.push({
            sourceId: doc.sourceId,
            chunkId: chunk.chunkId,
            title: doc.title,
            version: doc.version,
            classification: doc.classification,
            resourceScope: doc.resourceScope,
            updatedAt: doc.updatedAt,
            score: hybridScore,
            excerpt: this.sanitizeDocumentText(chunk.text),
          });
        }
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  sanitizeDocumentText(text: string): string {
    return text
      .replace(PROMPT_INJECTION_PATTERNS, '[redacted-untrusted-directive]')
      .replace(FORBIDDEN_SECRET_PATTERNS, '[redacted-secret]')
      .trim();
  }

  private chunkText(text: string, maxChars: number): string[] {
    const paragraphs = text
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter(Boolean);
    const chunks: string[] = [];
    let current = '';
    for (const para of paragraphs) {
      if ((current + '\n\n' + para).trim().length <= maxChars) {
        current = current ? `${current}\n\n${para}` : para;
      } else {
        if (current) chunks.push(current);
        if (para.length <= maxChars) {
          current = para;
        } else {
          for (let i = 0; i < para.length; i += maxChars) {
            chunks.push(para.slice(i, i + maxChars));
          }
          current = '';
        }
      }
    }
    if (current) chunks.push(current);
    return chunks.length ? chunks : [text.slice(0, maxChars)];
  }
}
