import { Injectable } from '@nestjs/common';

@Injectable()
export class ApplicationService {
  getHello(): string {
    return 'Gestion des Bulletins API is Live!';
  }
}
