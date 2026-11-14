/**
 * Module skeleton generator script.
 * Run: npx ts-node scripts/gen-modules.ts
 */
import * as fs from 'fs';
import * as path from 'path';

interface ModuleDef {
  name: string;         // kebab-case
  className: string;    // PascalCase
  hasCrud: boolean;
  hasEvents?: boolean;
  hasPolicies?: boolean;
  hasProviders?: boolean;
}

const modules: ModuleDef[] = [
  { name: 'users', className: 'Users', hasCrud: true },
  { name: 'roles', className: 'Roles', hasCrud: true },
  { name: 'permissions', className: 'Permissions', hasCrud: true },
  { name: 'courses', className: 'Courses', hasCrud: true, hasEvents: true, hasPolicies: true },
  { name: 'lessons', className: 'Lessons', hasCrud: true, hasEvents: true, hasPolicies: true },
  { name: 'videos', className: 'Videos', hasCrud: true, hasEvents: true },
  { name: 'video-sessions', className: 'VideoSessions', hasCrud: false },
  { name: 'quizzes', className: 'Quizzes', hasCrud: true, hasEvents: true },
  { name: 'progress', className: 'Progress', hasCrud: false },
  { name: 'uploads', className: 'Uploads', hasCrud: false },
  { name: 'storage', className: 'Storage', hasCrud: false },
  { name: 'file-processing', className: 'FileProcessing', hasCrud: false },
  { name: 'cdn', className: 'Cdn', hasCrud: false, hasProviders: true },
  { name: 'search', className: 'Search', hasCrud: false },
  { name: 'analytics', className: 'Analytics', hasCrud: false },
  { name: 'dashboard', className: 'Dashboard', hasCrud: false },
  { name: 'notifications', className: 'Notifications', hasCrud: false },
  { name: 'mail', className: 'Mail', hasCrud: false, hasProviders: true },
  { name: 'scheduler', className: 'Scheduler', hasCrud: false },
  { name: 'audit', className: 'Audit', hasCrud: false },
  { name: 'settings', className: 'Settings', hasCrud: true },
  { name: 'feature-flags', className: 'FeatureFlags', hasCrud: true },
  { name: 'api-keys', className: 'ApiKeys', hasCrud: true, hasPolicies: true },
  { name: 'ai-gateway', className: 'AiGateway', hasCrud: false, hasProviders: true },
  { name: 'backup', className: 'Backup', hasCrud: false, hasEvents: true },
  { name: 'system', className: 'System', hasCrud: false },
];

const BASE = path.join(__dirname, '..', 'src', 'modules');

function genController(mod: ModuleDef): string {
  const tag = mod.className.replace(/([A-Z])/g, ' $1').trim();
  const lines = [
    `import { Controller${mod.hasCrud ? ', Get, Post, Put, Delete, Param, Body, Query' : ', Get'} } from '@nestjs/common';`,
    `import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';`,
    `import { ${mod.className}Service } from './${mod.name}.service';`,
    ...(mod.hasCrud ? [`import { PaginationQueryDto } from '../../shared/sdk';`] : []),
    '',
    `@ApiTags('${tag}')`,
    `@ApiBearerAuth('access-token')`,
    `@Controller('v1/${mod.name}')`,
    `export class ${mod.className}Controller {`,
    `  constructor(private readonly ${camelize(mod.name)}Service: ${mod.className}Service) {}`,
  ];

  if (mod.hasCrud) {
    lines.push(
      '',
      `  @Get()`,
      `  @ApiOperation({ summary: 'List all ${mod.name}' })`,
      `  findAll(@Query() query: PaginationQueryDto) {`,
      `    return this.${camelize(mod.name)}Service.findAll(query);`,
      `  }`,
      '',
      `  @Get(':id')`,
      `  @ApiOperation({ summary: 'Get ${mod.name} by id' })`,
      `  findOne(@Param('id') id: string) {`,
      `    return this.${camelize(mod.name)}Service.findById(id);`,
      `  }`,
      '',
      `  @Post()`,
      `  @ApiOperation({ summary: 'Create ${mod.name}' })`,
      `  create(@Body() dto: any) {`,
      `    return this.${camelize(mod.name)}Service.create(dto);`,
      `  }`,
      '',
      `  @Put(':id')`,
      `  @ApiOperation({ summary: 'Update ${mod.name}' })`,
      `  update(@Param('id') id: string, @Body() dto: any) {`,
      `    return this.${camelize(mod.name)}Service.update(id, dto);`,
      `  }`,
      '',
      `  @Delete(':id')`,
      `  @ApiOperation({ summary: 'Delete ${mod.name}' })`,
      `  remove(@Param('id') id: string) {`,
      `    return this.${camelize(mod.name)}Service.delete(id);`,
      `  }`,
    );
  }

  lines.push('}', '');
  return lines.join('\n');
}

function genService(mod: ModuleDef): string {
  const lines = [
    `import { Injectable } from '@nestjs/common';`,
    ...(mod.hasCrud ? [`import { PaginationQueryDto, PaginatedResult } from '../../shared/sdk';`] : []),
    '',
    `@Injectable()`,
    `export class ${mod.className}Service {`,
  ];

  if (mod.hasCrud) {
    lines.push(
      `  async findAll(query: PaginationQueryDto): Promise<PaginatedResult<any>> {`,
      `    // TODO: Implement`,
      `    throw new Error('Not implemented');`,
      `  }`,
      '',
      `  async findById(id: string): Promise<any> {`,
      `    // TODO: Implement`,
      `    throw new Error('Not implemented');`,
      `  }`,
      '',
      `  async create(data: any): Promise<any> {`,
      `    // TODO: Implement`,
      `    throw new Error('Not implemented');`,
      `  }`,
      '',
      `  async update(id: string, data: any): Promise<any> {`,
      `    // TODO: Implement`,
      `    throw new Error('Not implemented');`,
      `  }`,
      '',
      `  async delete(id: string): Promise<any> {`,
      `    // TODO: Implement`,
      `    throw new Error('Not implemented');`,
      `  }`,
    );
  }

  lines.push('}', '');
  return lines.join('\n');
}

function genModule(mod: ModuleDef): string {
  return [
    `import { Module } from '@nestjs/common';`,
    `import { ${mod.className}Controller } from './${mod.name}.controller';`,
    `import { ${mod.className}Service } from './${mod.name}.service';`,
    '',
    `@Module({`,
    `  controllers: [${mod.className}Controller],`,
    `  providers: [${mod.className}Service],`,
    `  exports: [${mod.className}Service],`,
    `})`,
    `export class ${mod.className}Module {}`,
    '',
  ].join('\n');
}

function camelize(str: string): string {
  return str.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

// Generate
for (const mod of modules) {
  const dir = path.join(BASE, mod.name);
  fs.mkdirSync(path.join(dir, 'dto'), { recursive: true });

  if (mod.hasEvents) fs.mkdirSync(path.join(dir, 'events'), { recursive: true });
  if (mod.hasPolicies) fs.mkdirSync(path.join(dir, 'policies'), { recursive: true });
  if (mod.hasProviders) fs.mkdirSync(path.join(dir, 'providers'), { recursive: true });

  // Don't overwrite existing files
  const controllerPath = path.join(dir, `${mod.name}.controller.ts`);
  const servicePath = path.join(dir, `${mod.name}.service.ts`);
  const modulePath = path.join(dir, `${mod.name}.module.ts`);

  if (!fs.existsSync(controllerPath)) fs.writeFileSync(controllerPath, genController(mod));
  if (!fs.existsSync(servicePath)) fs.writeFileSync(servicePath, genService(mod));
  if (!fs.existsSync(modulePath)) fs.writeFileSync(modulePath, genModule(mod));

  console.log(`✅ ${mod.className}Module generated`);
}

console.log('\n🎉 All module skeletons generated!');
