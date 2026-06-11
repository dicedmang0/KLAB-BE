import { Module } from '@nestjs/common';
import { CreditsService } from './credits.service';

/**
 * CreditsService operates through the injected DataSource / a caller-supplied
 * EntityManager, so no repositories need to be registered here. Keeping this
 * module dependency-free avoids a cycle with MembersModule / BookingsModule.
 */
@Module({
  providers: [CreditsService],
  exports: [CreditsService],
})
export class CreditsModule {}
