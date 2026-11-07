import {
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { z } from 'zod';
import { AttachmentsService } from './attachments.service';
import { EncountersService } from '../encounters/encounters.service';
import { AccessService } from '../common/access.service';
import { CurrentUser } from '../common/current-user.decorator';
import type { AuthContext } from '../common/auth-context';
import { Roles } from '../common/decorators';
import { forbidden, notFound, validationError } from '../common/errors';
import { parseWithSchema } from '../common/validation';
import { emptyQuerySchema } from '../common/schemas';
import { canReadAttachment } from '../common/policies';
import { AuditService } from '../audit/audit.service';
import { APP_CONFIG, AppConfig } from '../config/config';

const idParamSchema = z.object({ id: z.coerce.number().int().positive() }).strict();

export interface UploadedFileLike {
  originalname: string;
  buffer: Buffer;
  size: number;
}

@Controller()
export class AttachmentsController {
  constructor(
    private readonly attachments: AttachmentsService,
    private readonly encounters: EncountersService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  @Post('encounters/:id/attachments')
  @Roles('professional')
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @Param() params: Record<string, string>,
    @Query() query: Record<string, unknown>,
    @UploadedFile() file: UploadedFileLike | undefined,
    @CurrentUser() user: AuthContext,
  ): Promise<unknown> {
    parseWithSchema(emptyQuerySchema, query);
    const { id } = parseWithSchema(idParamSchema, params);
    const encounter = await this.encounters.findById(id);
    if (encounter === null) {
      throw notFound('Encounter not found');
    }
    const professionalId = await this.access.professionalIdForUser(user.userId);
    if (professionalId === null || professionalId !== encounter.professionalId) {
      throw forbidden('Only the authoring professional can add attachments');
    }
    if (!file || !file.buffer) {
      throw validationError('A file field is required');
    }
    return this.attachments.store(
      user.userId,
      {
        id: encounter.id,
        professionalId: encounter.professionalId,
        patientId: encounter.patientId,
      },
      { originalname: file.originalname, buffer: file.buffer, size: file.size },
    );
  }

  @Get('attachments/:id')
  @Roles('patient', 'professional')
  async download(
    @Param() params: Record<string, string>,
    @Query() query: Record<string, unknown>,
    @CurrentUser() user: AuthContext,
    @Res() response: Response,
  ): Promise<void> {
    parseWithSchema(emptyQuerySchema, query);
    const { id } = parseWithSchema(idParamSchema, params);
    const attachment = await this.attachments.findWithOwner(id);
    if (attachment === null) {
      throw notFound('Attachment not found');
    }
    const actor = {
      userId: user.userId,
      roles: user.roles,
      patientId: await this.access.patientIdForUser(user.userId),
      professionalId: await this.access.professionalIdForUser(user.userId),
    };
    const allowed = canReadAttachment(actor, {
      encounterProfessionalId: attachment.professionalId,
      encounterPatientId: attachment.patientId,
    });
    if (!allowed) {
      throw forbidden('You are not allowed to download this attachment');
    }
    const content = await this.attachments.readContent(attachment.storedName);
    await this.audit.record({
      actorId: user.userId,
      action: 'attachment_read',
      resourceType: 'adjunto',
      resourceId: attachment.id,
    });
    response.setHeader('Content-Type', attachment.mimeType);
    response.setHeader('Content-Length', String(content.length));
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${attachment.filename.replace(/["\\]/g, '_')}"`,
    );
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.status(200).send(content);
  }
}
