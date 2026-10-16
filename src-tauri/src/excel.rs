//! Excel 工作簿解包(spec 03 §2 / ADR-0004):Rust 只做「读」——用 calamine 把 xlsx
//! 读成中性结构 WorkbookData,经 Tauri 命令一次交给前端;表名映射、表头校验、行归一
//! 与全部校验清单都在 TS domain(src/domain/excelImport.ts),Rust 不认识「角色活动
//! 祈愿」,不做任何语义判断。源文件只读,绝不写回。

use std::path::Path;

use calamine::{open_workbook, Data, Reader, Xlsx};
use serde::Serialize;
use tauri::AppHandle;

/// 文件大小上限 20MB(读前 fs::metadata 校验,spec 03 §2)
const MAX_FILE_BYTES: u64 = 20 * 1024 * 1024;
/// 全工作簿总行数上限(逐表累计,超限即停,防大表撑爆内存)
const MAX_TOTAL_ROWS: usize = 200_000;

/// 单个单元格的中性表示(ADR-0004 Cell 记法):
/// `t` = "s" 文本 | "n" 数值 | "b" 布尔 | "e" 公式错误 | "null" 空单元格
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ExcelCell {
    pub t: String,
    pub v: serde_json::Value,
}

/// 一张工作表:表名 + 全部行;空行原样保留(TS 层跳过全空行),表序 = 工作簿内顺序
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SheetData {
    pub name: String,
    pub rows: Vec<Vec<ExcelCell>>,
}

/// 整个工作簿(按 spec 03 §2:`{ sheets: [{ name, rows: Cell[][] }] }`)
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct WorkbookData {
    pub sheets: Vec<SheetData>,
}

/// f64 → JSON 数值;NaN/±∞ 不是合法 JSON 数值,v 置 null(t 仍为 "n",不静默改类型)
fn json_f64(f: f64) -> serde_json::Value {
    serde_json::Number::from_f64(f)
        .map(serde_json::Value::Number)
        .unwrap_or(serde_json::Value::Null)
}

/// calamine Data → 中性 Cell 的类型保真映射(Rust 不猜语义):
/// - String→s、Bool→b、Empty→null 原样;
/// - Int/Float/DateTime 统一为数值 "n";Int 走 i64 直转 serde_json::Number 无损,
///   DateTime 为 Excel 日期序列数浮点——不做日期转换(ADR-0004 后果条:时间列若为
///   日期类型,由 TS 按「时间列须为文本」报校验错误);
/// - DateTimeIso/DurationIso 单元格内容本就是 ISO 文本串,按文本 "s" 保真;
/// - Error→"e",v 为官方错误串(如 "#REF!"),TS 按 D3 ERROR 行处理。
fn map_cell(data: &Data) -> ExcelCell {
    let (t, v) = match data {
        Data::Empty => ("null", serde_json::Value::Null),
        Data::String(s) => ("s", serde_json::Value::String(s.clone())),
        Data::Bool(b) => ("b", serde_json::Value::Bool(*b)),
        Data::Int(n) => ("n", serde_json::Value::Number((*n).into())),
        Data::Float(f) => ("n", json_f64(*f)),
        Data::DateTime(dt) => ("n", json_f64(dt.as_f64())),
        Data::DateTimeIso(s) | Data::DurationIso(s) => {
            ("s", serde_json::Value::String(s.clone()))
        }
        Data::Error(e) => ("e", serde_json::Value::String(e.to_string())),
    };
    ExcelCell {
        t: t.to_string(),
        v,
    }
}

/// 扩展名须为 .xlsx(大小写不敏感);其余(.xls/.xlsm/无扩展名等)明确拒绝
fn ensure_xlsx_extension(path: &str) -> Result<(), String> {
    let is_xlsx = Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("xlsx"));
    if is_xlsx {
        Ok(())
    } else {
        Err(format!("仅支持 .xlsx 文件:{path}"))
    }
}

/// 文件大小 ≤20MB(spec 03 §2);超限明确拒绝,不整本载入内存
fn ensure_file_size(len: u64) -> Result<(), String> {
    if len > MAX_FILE_BYTES {
        Err(format!(
            "文件超过 20MB 大小上限(实际 {len} 字节),已拒绝读取"
        ))
    } else {
        Ok(())
    }
}

/// 逐表累计总行数并校验 200,000 上限;超限返回 Err(含触发的表名),调用方立即中止
fn accumulate_rows(total: usize, sheet_name: &str, sheet_rows: usize) -> Result<usize, String> {
    let next = total.saturating_add(sheet_rows);
    if next > MAX_TOTAL_ROWS {
        return Err(format!(
            "工作簿总行数超过 200000 行上限(读至表「{sheet_name}」时超限),已中止导入"
        ));
    }
    Ok(next)
}

fn extract_xlsx_impl(path: &str) -> Result<WorkbookData, String> {
    ensure_xlsx_extension(path)?;
    let meta = std::fs::metadata(Path::new(path)).map_err(|e| format!("读取文件失败:{e}"))?;
    ensure_file_size(meta.len())?;

    let mut workbook: Xlsx<_> = open_workbook(path).map_err(|e| format!("打开 xlsx 失败:{e}"))?;
    let mut sheets = Vec::new();
    let mut total_rows = 0usize;
    for name in workbook.sheet_names() {
        let range = workbook
            .worksheet_range(&name)
            .map_err(|e| format!("读取工作表「{name}」失败:{e}"))?;
        // 先按表的行数累计校验上限,超限立即中止,不再为后续表物化行数据
        total_rows = accumulate_rows(total_rows, &name, range.height())?;
        let rows = range
            .rows()
            .map(|row| row.iter().map(map_cell).collect())
            .collect();
        sheets.push(SheetData { name, rows });
    }
    Ok(WorkbookData { sheets })
}

/// Excel 迁入解包(spec 03 §2):xlsx → 中性结构一次性交给前端语义层;
/// 超限/非 xlsx 等拒绝均以中文错误文案返回(UI 直显)
#[tauri::command(async)]
pub fn extract_xlsx(_app: AppHandle, path: String) -> Result<WorkbookData, String> {
    extract_xlsx_impl(&path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use calamine::{CellErrorType, ExcelDateTime, ExcelDateTimeType};

    /// 构造日期序列数单元格(如 44563.5 = 2022-01-08 12:00:00 的 Excel 序列数)
    fn datetime(value: f64) -> Data {
        Data::DateTime(ExcelDateTime::new(
            value,
            ExcelDateTimeType::DateTime,
            false,
        ))
    }

    #[test]
    fn map_cell_preserves_all_types() {
        // 五种目标类型各自的原样保真
        assert_eq!(map_cell(&Data::Empty), ExcelCell { t: "null".into(), v: serde_json::Value::Null });
        assert_eq!(map_cell(&Data::String("时间".into())), ExcelCell { t: "s".into(), v: "时间".into() });
        assert_eq!(map_cell(&Data::Bool(true)), ExcelCell { t: "b".into(), v: serde_json::Value::Bool(true) });
        assert_eq!(map_cell(&Data::Float(62.5)), ExcelCell { t: "n".into(), v: serde_json::json!(62.5) });
        assert_eq!(
            map_cell(&Data::Error(CellErrorType::Ref)),
            ExcelCell { t: "e".into(), v: "#REF!".into() }
        );

        // Int 经 serde_json::Number 无损(用 i64::MAX 钉住不丢精度)
        assert_eq!(
            map_cell(&Data::Int(i64::MAX)),
            ExcelCell { t: "n".into(), v: serde_json::json!(9223372036854775807u64) }
        );

        // 日期序列数 → 数值浮点,不做日期转换(ADR-0004 后果条)
        assert_eq!(map_cell(&datetime(44563.5)), ExcelCell { t: "n".into(), v: serde_json::json!(44563.5) });

        // ISO 日期/时长是文本串,按文本保真(TS 校验不认它即报错,不静默)
        assert_eq!(
            map_cell(&Data::DateTimeIso("2022-01-08T12:00:00".into())),
            ExcelCell { t: "s".into(), v: "2022-01-08T12:00:00".into() }
        );
        assert_eq!(
            map_cell(&Data::DurationIso("PT1H30M".into())),
            ExcelCell { t: "s".into(), v: "PT1H30M".into() }
        );
    }

    #[test]
    fn map_cell_non_finite_float_degrades_value_to_null() {
        // NaN/±∞ 不是合法 JSON 数值:v 置 null,t 仍为 "n"(不静默改成别的类型)
        assert_eq!(map_cell(&Data::Float(f64::NAN)).v, serde_json::Value::Null);
        assert_eq!(map_cell(&Data::Float(f64::INFINITY)).v, serde_json::Value::Null);
        assert_eq!(map_cell(&Data::Float(f64::NAN)).t, "n");
    }

    #[test]
    fn serde_shape_matches_adr_cell_notation() {
        // 钉住线上形状:{"sheets":[{"name":..,"rows":[[{"t":..,"v":..}]]}]},字段小写单字母
        let wb = WorkbookData {
            sheets: vec![SheetData {
                name: "角色活动祈愿".into(),
                rows: vec![vec![
                    map_cell(&Data::String("2022-01-08 12:00:00".into())),
                    map_cell(&Data::Int(5)),
                    map_cell(&Data::Empty),
                ]],
            }],
        };
        assert_eq!(
            serde_json::to_value(&wb).unwrap(),
            serde_json::json!({
                "sheets": [{
                    "name": "角色活动祈愿",
                    "rows": [[
                        {"t": "s", "v": "2022-01-08 12:00:00"},
                        {"t": "n", "v": 5},
                        {"t": "null", "v": null}
                    ]]
                }]
            })
        );
    }

    #[test]
    fn xlsx_extension_check_is_exact_and_case_insensitive() {
        assert!(ensure_xlsx_extension("a.xlsx").is_ok());
        assert!(ensure_xlsx_extension("A.XLSX").is_ok());
        assert!(ensure_xlsx_extension("/tmp/记录表.Xlsx").is_ok());
        assert!(ensure_xlsx_extension("table.xls").is_err());
        assert!(ensure_xlsx_extension("table.xlsm").is_err());
        assert!(ensure_xlsx_extension("table.xlsx.zip").is_err());
        assert!(ensure_xlsx_extension("noext").is_err());
        assert!(ensure_xlsx_extension("").is_err());
    }

    #[test]
    fn file_size_limit_is_inclusive_at_20mb() {
        assert!(ensure_file_size(0).is_ok());
        assert!(ensure_file_size(MAX_FILE_BYTES).is_ok());
        let err = ensure_file_size(MAX_FILE_BYTES + 1).unwrap_err();
        assert!(err.contains("20MB"), "错误文案须含上限:{err}");
        let actual = (MAX_FILE_BYTES + 1).to_string();
        assert!(err.contains(&actual), "错误文案须含实际字节:{err}");
    }

    #[test]
    fn row_accumulation_enforces_total_limit_and_stops() {
        assert_eq!(accumulate_rows(0, "角色活动祈愿", 5).unwrap(), 5);
        // 恰好触顶合法
        assert_eq!(accumulate_rows(100_000, "常驻祈愿", 100_000).unwrap(), 200_000);
        // 超限:错误文案带触发的表名
        let err = accumulate_rows(199_999, "武器活动祈愿", 2).unwrap_err();
        assert!(err.contains("200000"), "错误文案须含上限:{err}");
        assert!(err.contains("武器活动祈愿"), "错误文案须含触发表名:{err}");
        // 溢出也不 panic(saturating),同样走超限拒绝
        assert!(accumulate_rows(usize::MAX, "x", 1).is_err());
    }

    fn temp_excel_dir(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "genshintool_excel_{tag}_{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("应能创建临时目录");
        dir
    }

    #[test]
    fn extract_rejects_non_xlsx_extension_and_missing_file() {
        let dir = temp_excel_dir("ext");
        let txt = dir.join("记录.txt");
        std::fs::write(&txt, b"hello").unwrap();
        let err = extract_xlsx_impl(txt.to_str().unwrap()).unwrap_err();
        assert!(err.contains("仅支持 .xlsx"), "非 xlsx 扩展名须明确拒绝:{err}");

        // 扩展名对但文件不存在 → 元数据阶段失败
        let err = extract_xlsx_impl(dir.join("不存在.xlsx").to_str().unwrap()).unwrap_err();
        assert!(err.contains("读取文件失败"), "缺失文件须明确报错:{err}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn extract_rejects_fake_xlsx_content() {
        // 扩展名/大小合法但内容不是 zip:打开阶段失败(calamine 报错原样带出)
        let dir = temp_excel_dir("fake");
        let fake = dir.join("fake.xlsx");
        std::fs::write(&fake, b"this is not a zip archive").unwrap();
        let err = extract_xlsx_impl(fake.to_str().unwrap()).unwrap_err();
        assert!(err.contains("打开 xlsx 失败"), "损坏文件须明确报错:{err}");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
