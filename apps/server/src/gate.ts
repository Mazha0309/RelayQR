import { z } from "zod";

const questionBase = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, "题目 ID 无效"),
  prompt: z.string().trim().min(1, "题目不能为空").max(200, "题目最多 200 个字符"),
});

const choiceQuestionSchema = questionBase.extend({
  type: z.literal("choice"),
  options: z.array(z.string().trim().min(1, "选项不能为空").max(100, "选项最多 100 个字符")).min(2, "每题至少两个选项").max(8, "每题最多八个选项"),
  correctOption: z.number().int().min(0),
});

const textQuestionSchema = questionBase.extend({
  type: z.literal("text"),
  correctAnswer: z.string().trim().min(1, "标准答案不能为空").max(200, "标准答案最多 200 个字符"),
});

export const gateQuestionSchema = z.discriminatedUnion("type", [choiceQuestionSchema, textQuestionSchema]);

const gateSettingsBaseSchema = z.object({
  enabled: z.boolean(),
  locationEnabled: z.boolean(),
  allowedRegions: z.array(z.string().trim().min(2, "属地名称至少两个字符").max(40)).max(30, "最多设置 30 个允许属地"),
  questions: z.array(gateQuestionSchema).max(10, "最多添加 10 道题"),
});

export const gateSettingsSchema = gateSettingsBaseSchema.superRefine((settings, context) => {
  if (settings.locationEnabled && settings.allowedRegions.length === 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["allowedRegions"], message: "启用属地筛选时至少填写一个允许属地" });
  }
  if (settings.enabled && !settings.locationEnabled && settings.questions.length === 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "至少启用属地筛选或添加一道题" });
  }
  if (new Set(settings.questions.map((question) => question.id)).size !== settings.questions.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["questions"], message: "题目 ID 不能重复" });
  }
  settings.questions.forEach((question, index) => {
    if (question.type === "choice" && question.correctOption >= question.options.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["questions", index, "correctOption"], message: "正确答案超出选项范围" });
    }
    if (question.type === "choice" && new Set(question.options).size !== question.options.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["questions", index, "options"], message: "同一题的选项不能重复" });
    }
  });
});

const gateConfigSchema = gateSettingsBaseSchema.omit({ enabled: true });

export interface GateConfig {
  locationEnabled: boolean;
  allowedRegions: string[];
  questions: Array<{
    id: string;
    prompt: string;
  } & ({
    type: "choice";
    options: string[];
    correctOption: number;
  } | {
    type: "text";
    correctAnswer: string;
  })>;
}

export const emptyGateConfig: GateConfig = { locationEnabled: false, allowedRegions: [], questions: [] };

export function parseGateConfig(value: string | null | undefined): GateConfig {
  try {
    const result = gateConfigSchema.safeParse(JSON.parse(value ?? "{}"));
    return result.success ? result.data : emptyGateConfig;
  } catch {
    return emptyGateConfig;
  }
}

export function normalizedGateConfig(settings: z.infer<typeof gateSettingsSchema>): GateConfig {
  return {
    locationEnabled: settings.locationEnabled,
    allowedRegions: [...new Set(settings.allowedRegions.map((region) => region.trim()))],
    questions: settings.questions.map((question) => question.type === "choice" ? ({
      ...question,
      prompt: question.prompt.trim(),
      options: question.options.map((option) => option.trim()),
    }) : ({
      ...question,
      prompt: question.prompt.trim(),
      correctAnswer: question.correctAnswer.trim(),
    })),
  };
}
