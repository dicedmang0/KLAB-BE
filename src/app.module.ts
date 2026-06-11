import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { APP_GUARD } from '@nestjs/core';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';

import appConfig from './config/app.config';
import databaseConfig from './config/database.config';
import jwtConfig from './config/jwt.config';
import { envValidationSchema } from './config/env.validation';

import { HealthModule } from './health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { RolesModule } from './modules/roles/roles.module';
import { RoomsModule } from './modules/rooms/rooms.module';
import { InstructorsModule } from './modules/instructors/instructors.module';
import { ClassTypesModule } from './modules/class-types/class-types.module';
import { PackagesModule } from './modules/packages/packages.module';
import { SchedulesModule } from './modules/schedules/schedules.module';
import { MembersModule } from './modules/members/members.module';
import { CreditsModule } from './modules/credits/credits.module';
import { BookingsModule } from './modules/bookings/bookings.module';
import { MemberPackagesModule } from './modules/member-packages/member-packages.module';
import { PublicModule } from './modules/public/public.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, databaseConfig, jwtConfig],
      validationSchema: envValidationSchema,
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        config.get<TypeOrmModuleOptions>('database') as TypeOrmModuleOptions,
    }),
    HealthModule,
    AuthModule,
    UsersModule,
    RolesModule,
    RoomsModule,
    InstructorsModule,
    ClassTypesModule,
    PackagesModule,
    SchedulesModule,
    MembersModule,
    CreditsModule,
    BookingsModule,
    MemberPackagesModule,
    PublicModule,
  ],
  providers: [
    // JwtAuthGuard runs first to populate req.user, then RolesGuard reads it
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
