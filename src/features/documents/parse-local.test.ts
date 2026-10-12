import { it, expect } from 'vitest';
import { parseLocal } from '@/features/documents/parse-local';

it("maps fields and products locally", () => {
  const p = parseLocal("卖方公司：测试公司\nWidget,10,2.50,PCS");
  expect(p.fields.seller).toBe("测试公司");
  expect(p.rows[0].qty).toBe("10");
});
