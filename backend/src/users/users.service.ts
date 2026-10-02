import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
  ) {}

  /**
   * Creates a new user in the database.
   */
  create(createUserDto: CreateUserDto) {
    const user = this.usersRepository.create(createUserDto);
    return this.usersRepository.save(user);
  }

  /**
   * Retrieves all users.
   */
  findAll() {
    return this.usersRepository.find();
  }

  /**
   * Finds a user by their ID.
   */
  findOne(id: string) {
    return this.usersRepository.findOneBy({ id });
  }

  /**
   * Finds a user by their email address.
   */
  findByEmail(email: string) {
    return this.usersRepository.findOneBy({ email });
  }

  /**
   * Updates a user's information.
   */
  update(id: string, updateUserDto: UpdateUserDto) {
    // Nothing writable left after validation (e.g. only groups was sent).
    // TypeORM rejects an empty update, so report no change instead of a 500.
    if (Object.values(updateUserDto).every((v) => v === undefined)) {
      return Promise.resolve({ generatedMaps: [], raw: [], affected: 0 });
    }
    return this.usersRepository.update(id, updateUserDto);
  }

  /**
   * Removes a user from the database.
   */
  remove(id: string) {
    return this.usersRepository.delete(id);
  }
}
