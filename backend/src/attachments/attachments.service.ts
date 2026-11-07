import { Inject, Injectable } from '@nestjs/common';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { DatabaseService } from '../database/database.service';
import { APP_CONFIG, AppConfig } from '../config/config';
import { AppError, forbidden, notFound } from '../common/errors';
import { AuditService } from '../audit/audit.service';

const ALLOWED_TYPES: Record<string, string> = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
};

export interface StoredAttachment {
  id: number;
  encounterId: number;
  filename: string;
  mimeType: string;
  size: number;
  createdAt: string;
}

function detectMime(buffer: Buffer): string | null {
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString('latin1') === '%PDF-') {
    return 'application/pdf';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'image/png';
  }
  return null;
}

export function sanitizeFilename(original: string): string {
  const base = original.replace(/\\/g, '/').split('/').pop() ?? 'attachment';
  const cleaned = base
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^[._]+/, '')
    .slice(0, 120);
  return cleaned.length > 0 ? cleaned : 'attachment';
}

@Injectable()
export class AttachmentsService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  private async ensureDirectory(): Promise<void> {
    await mkdir(this.config.attachmentsDir, { recursive: true });
  }

  async store(
    actorId: number,
    encounter: { id: number; professionalId: number; patientId: number },
    file: { originalname: string; buffer: Buffer; size: number },
  ): Promise<StoredAttachment> {
    // Size is checked before the content type: an oversized upload is rejected
    // as 413 even when its bytes do not identify an allowed type (RF-17).
    if (file.size === 0) {
      throw new AppError('validation_error', 'Attachment is empty', 422);
    }
    if (file.size > this.config.maxAttachmentBytes) {
      throw new AppError('payload_too_large', 'File exceeds the 5 MB limit', 413);
    }
    const detected = detectMime(file.buffer);
    if (detected === null || !(detected in ALLOWED_TYPES)) {
      throw new AppError(
        'unsupported_media_type',
        'Only PDF, JPEG and PNG attachments are allowed',
        415,
      );
    }

    await this.ensureDirectory();
    const safeName = sanitizeFilename(file.originalname);
    const extension = ALLOWED_TYPES[detected];
    const storedName = `${randomBytes(16).toString('hex')}${extension}`;
    const absolutePath = join(this.config.attachmentsDir, storedName);
    await writeFile(absolutePath, file.buffer);

    const inserted = await this.db.query<{
      id: number;
      creado_en: Date;
    }>(
      `INSERT INTO adjunto
         (encuentro_id, nombre_archivo, tipo_mime, tamano_bytes, ruta_almacenamiento, subido_por)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, creado_en`,
      [encounter.id, safeName, detected, file.size, storedName, actorId],
    );

    await this.audit.record({
      actorId,
      action: 'attachment_uploaded',
      resourceType: 'adjunto',
      resourceId: inserted.rows[0].id,
      detail: { encounterId: encounter.id, mimeType: detected, size: file.size },
    });

    return {
      id: inserted.rows[0].id,
      encounterId: encounter.id,
      filename: safeName,
      mimeType: detected,
      size: file.size,
      createdAt: inserted.rows[0].creado_en.toISOString(),
    };
  }

  async findWithOwner(id: number): Promise<{
    id: number;
    encounterId: number;
    filename: string;
    mimeType: string;
    size: number;
    storedName: string;
    professionalId: number;
    patientId: number;
    authorUserId: number;
  } | null> {
    const result = await this.db.query<{
      id: number;
      encuentro_id: number;
      nombre_archivo: string;
      tipo_mime: string;
      tamano_bytes: number;
      ruta_almacenamiento: string;
      profesional_id: number;
      paciente_id: number;
      subido_por: number;
    }>(
      `SELECT a.id, a.encuentro_id, a.nombre_archivo, a.tipo_mime, a.tamano_bytes,
              a.ruta_almacenamiento, e.profesional_id, e.paciente_id, a.subido_por
         FROM adjunto a
         JOIN encuentro e ON e.id = a.encuentro_id
        WHERE a.id = $1`,
      [id],
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      encounterId: row.encuentro_id,
      filename: row.nombre_archivo,
      mimeType: row.tipo_mime,
      size: row.tamano_bytes,
      storedName: row.ruta_almacenamiento,
      professionalId: row.profesional_id,
      patientId: row.paciente_id,
      authorUserId: row.subido_por,
    };
  }

  async readContent(storedName: string): Promise<Buffer> {
    const safe = storedName.replace(/[^A-Za-z0-9._-]/g, '');
    if (safe !== storedName) {
      throw forbidden('Attachment is not accessible');
    }
    try {
      return await readFile(join(this.config.attachmentsDir, safe));
    } catch {
      throw notFound('Attachment content not found');
    }
  }

  async removeStoredFile(storedName: string): Promise<void> {
    await unlink(join(this.config.attachmentsDir, storedName)).catch(() => undefined);
  }
}
