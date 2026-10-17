fn main() {
    // generate_context! 会将图标缓存后嵌入程序；更新图标时必须重新编译，不能沿用旧缓存。
    println!("cargo:rerun-if-changed=icons");
    tauri_build::build()
}
