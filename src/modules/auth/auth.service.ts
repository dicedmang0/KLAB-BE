import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  ForbiddenException,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { JwtPayload } from './strategies/jwt.strategy';
import { UsersService, SafeUser, toSafeUser } from '../users/users.service';
import { RolesService } from '../roles/roles.service';
import { User, UserStatus } from '../users/entities/user.entity';

const BCRYPT_ROUNDS = 12;
const MEMBER_ROLE = 'member';

export interface AuthResult {
  access_token: string;
  user: SafeUser;
}

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private rolesService: RolesService,
    private jwtService: JwtService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResult> {
    const existing = await this.usersService.findByEmail(dto.email);
    if (existing) {
      throw new ConflictException('Email is already registered');
    }

    // Every self-registered account is a member. The role must already be
    // seeded — we never create a user with a null role.
    const memberRole = await this.rolesService.findByName(MEMBER_ROLE);
    if (!memberRole) {
      throw new InternalServerErrorException(
        'Member role not found. Run the RBAC seed (npm run seed) before registering users.',
      );
    }

    const password_hash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    const user = await this.usersService.create({
      email: dto.email,
      password_hash,
      full_name: dto.full_name,
      phone: dto.phone,
      role_id: memberRole.id,
      status: UserStatus.ACTIVE,
    });

    return this.buildAuthResult(user, memberRole.name);
  }

  async login(dto: LoginDto): Promise<AuthResult> {
    const user = await this.usersService.findByEmail(dto.email);

    // Same generic message for unknown email and wrong password — no oracle.
    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const passwordValid = await bcrypt.compare(dto.password, user.password_hash);
    if (!passwordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException('Account is not active');
    }

    return this.buildAuthResult(user, user.role?.name ?? null);
  }

  async getMe(userId: string): Promise<SafeUser> {
    const user = await this.usersService.findByIdWithRole(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  private buildAuthResult(user: User, roleName: string | null): AuthResult {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      roleId: user.role_id ?? null,
      roleName,
    };

    return {
      access_token: this.jwtService.sign(payload),
      user: toSafeUser(user),
    };
  }
}
