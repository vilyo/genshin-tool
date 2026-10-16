//! 官方祈愿记录接口 HTTP 通道(spec 02 §1;ADR-0001:Rust 只做 IO)。
//!
//! 单次 GET:参数全部来自前端 domain 规范化后的链接(link.ts 重建的官方 API URL),
//! 无签名、不校验域名、不存储任何 authkey(D16);retcode 判定/限速/重试全在前端 domain。
//! G4 出网审计:本命令是应用内唯一主动出网的 HTTP 命令。

use std::sync::OnceLock;
use std::time::Duration;

use tauri::AppHandle;

/// 总超时(连接 + 响应体,spec 02 §1 定稿 30s)
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
/// 浏览器 UA:与客户端内嵌页请求同形,避免空 UA 被网关拦截(与鸣潮 gacha.rs 同款做法)
const USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/// 连接池复用的共享客户端(OnceLock:分页拉取的相邻请求保持 keep-alive)。
/// 构建失败几乎只可能是 TLS 后端初始化问题,把 Result 缓存后每次调用原样返回。
fn shared_client() -> Result<&'static reqwest::Client, String> {
    static CLIENT: OnceLock<Result<reqwest::Client, String>> = OnceLock::new();
    CLIENT
        .get_or_init(|| {
            reqwest::Client::builder()
                .timeout(REQUEST_TIMEOUT)
                .user_agent(USER_AGENT)
                .build()
                .map_err(|e| format!("HTTP 客户端初始化失败:{e}"))
        })
        .as_ref()
        .map_err(Clone::clone)
}

/// HTTP 非 2xx:按网络类失败聚合报错(前端归 NetworkError,受 3 次重试保护)
fn status_message(status: reqwest::StatusCode) -> String {
    format!("官方接口响应异常(HTTP {status}),请检查网络后重试")
}

/// 拉取任一官方祈愿接口 URL,返回响应体原文(解析与判定在前端 domain)
#[tauri::command(async)]
pub async fn gacha_get(_app: AppHandle, url: String) -> Result<String, String> {
    let client = shared_client()?;
    let response = client
        .get(url.trim())
        .send()
        .await
        .map_err(|e| format!("祈愿记录请求失败:{e}"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(status_message(status));
    }
    response
        .text()
        .await
        .map_err(|e| format!("读取祈愿记录响应失败:{e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn non_success_status_is_aggregated_into_message() {
        assert_eq!(
            status_message(reqwest::StatusCode::BAD_GATEWAY),
            "官方接口响应异常(HTTP 502 Bad Gateway),请检查网络后重试"
        );
    }

    #[test]
    fn shared_client_reuses_one_instance() {
        let first = shared_client().unwrap();
        let second = shared_client().unwrap();
        assert!(std::ptr::eq(first, second));
    }
}
