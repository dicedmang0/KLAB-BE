import { Injectable } from '@nestjs/common';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  // TODO: implement — inject UsersService, JwtService, bcrypt
  async register(dto: RegisterDto): Promise<any> {
    void dto;
    throw new Error('Not implemented');
  }

  async login(dto: LoginDto): Promise<any> {
    void dto;
    throw new Error('Not implemented');
  }

  async getMe(userId: string): Promise<any> {
    void userId;
    throw new Error('Not implemented');
  }
}
