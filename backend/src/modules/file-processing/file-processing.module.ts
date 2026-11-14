import { Module } from '@nestjs/common';
import { FileProcessingController } from './file-processing.controller';
import { FileProcessingService } from './file-processing.service';

@Module({
  controllers: [FileProcessingController],
  providers: [FileProcessingService],
  exports: [FileProcessingService],
})
export class FileProcessingModule {}
