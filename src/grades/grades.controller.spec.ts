import { Test, TestingModule } from '@nestjs/testing';
import { GradesController } from './grades.controller';

describe('GradesController', () => {
  let controller: GradesController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [GradesController],
    }).compile();

    controller = module.get<GradesController>(GradesController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
