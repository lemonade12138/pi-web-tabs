fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new().commands(&[
                "open_external_preview",
                "resize_external_preview",
                "close_external_preview",
            ]),
        ),
    )
    .expect("failed to run tauri-build");
}
