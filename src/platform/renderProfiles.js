// 环境纹理按平台分组；不覆盖主画面密度、抗锯齿、人物、墨图或玩法设置。
// 先接入已验证的云图和本轮待验证的远景反射，其他资源不批量降档。
const PC_ENVIRONMENT = Object.freeze({
  id: 'pc-original-v1', cloudWidth: 2048, cloudHeight: 640, farReflectionSize: 512,
});
const MOBILE_ENVIRONMENT = Object.freeze({
  id: 'mobile-environment-v1', cloudWidth: 512, cloudHeight: 160, farReflectionSize: 256,
});

// 在资源创建时选择，避免模块导入时机影响平台判断；不按品牌猜测性能。
export function environmentTextureProfile(mobile = !!globalThis.inkwaveMobile) {
  return mobile ? MOBILE_ENVIRONMENT : PC_ENVIRONMENT;
}
