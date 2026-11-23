-- Fictional listings for the Campus Loop coursework demo.
insert into public.listings (id, kind, title, description, category, mode, condition, defects, price, display_name, search_terms, art, simulated)
values
  ('67e8e9a4-197b-41c8-ad16-033d21741a31', 'offer', 'Adjustable USB desk lamp', 'Warm and neutral light. Pick up near the library.', 'study', 'free', 'working', 'Small mark on the base.', null, 'Demo Alex', '檯燈 台灯 書桌 candeeiro secretária', 'lamp', true),
  ('844f6bf2-8505-4b24-870d-64ebd748617e', 'offer', 'Calculus textbook', 'Second-year calculus. All pages intact.', 'study', 'sell', 'working', 'Pencil notes on two chapters.', 40, 'Demo Rui', '微積分 微积分 課本 课本 livro cálculo', 'books', true),
  ('20cba65c-9492-4516-9313-643a7d49039f', 'offer', 'Stackable storage box', 'Clean 40 × 30 × 25 cm box.', 'home', 'free', 'working', 'Light scuffs outside.', null, 'Demo Jo', '收納箱 收纳箱 caixa arrumação', 'box', true),
  ('bd7290db-9ec8-4200-9ee8-a07c42e29f1b', 'offer', 'USB keyboard', 'Wired keyboard with all keys working.', 'electronics', 'sell', 'working', 'Minor wear on the space bar.', 30, 'Demo Ana', '鍵盤 键盘 teclado', 'keyboard', true),
  ('39194219-12b2-40e7-b840-9de1512be36f', 'request', 'Free desk lamp for studying', 'Looking for a USB lamp for study. I can collect it on campus.', 'study', 'free', null, '', null, 'Demo Rui', '檯燈 台灯 書桌 candeeiro secretária', 'lamp', true),
  ('c1251e52-1a11-46f8-be05-b1bd305acd38', 'request', 'Buying a study desk lamp', 'I can pay for a working desk lamp.', 'study', 'sell', null, '', null, 'Demo Alex', '檯燈 台灯 書桌 candeeiro secretária', 'lamp', true),
  ('b8188840-034f-401c-8bd2-25c012976880', 'request', 'Free lamp for a bedside table', 'Any small lamp would suit my room.', 'home', 'free', null, '', null, 'Demo Ana', '檯燈 台灯 desk lamp candeeiro', 'lamp', true)
on conflict (id) do nothing;
