import { Module } from '@nestjs/common';
import { LearningAccessService } from '../progress/learning-access.service';
import { LabFilesController } from './lab-files.controller';
import { LabFilesService } from './lab-files.service';

@Module({ controllers: [LabFilesController], providers: [LabFilesService, LearningAccessService] })
export class LabFilesModule {}
