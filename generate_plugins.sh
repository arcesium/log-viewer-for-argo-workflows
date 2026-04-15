#!/bin/sh

mkdir -p build

generate_build() {
    browser=$1
    version=$2
    manifest_file="manifest_${version}.json"

    dir="build/${browser}/${version}"
    mkdir -p "${dir}"

    cp -r src/css src/html src/icons src/inject.js src/worker.js "${dir}/"
    cp "src/${manifest_file}" "${dir}/manifest.json"

    (cd "${dir}" && zip -r "../${version}.zip" *)
}

generate_build "firefox" "v2"
generate_build "chrome" "v3"

echo "Extension packages created successfully!"
