import os
import json
import zipfile

# Define selected folders to include in the release
selected_folders = ['scripts', 'styles', 'templates', 'languages']

def read_module_info():
    with open('module.json', 'r', encoding='utf-8') as file:
        data = json.load(file)
        return data['id'], data['version']

def create_dist_folder():
    if not os.path.exists('dist'):
        os.makedirs('dist')

def add_folder_to_zip(zip_file, folder):
    if os.path.exists(folder):
        for root, dirs, files in os.walk(folder):
            for file in files:
                file_path = os.path.join(root, file)
                # Keep the folder structure in the zip
                zip_file.write(file_path)
    else:
        print(f"Warning: {folder} is missing. Skipping.")

def create_zip(module_id, module_version, folders):
    zip_filename = f'dist/{module_id}-{module_version}.zip'
    
    with zipfile.ZipFile(zip_filename, 'w', zipfile.ZIP_DEFLATED) as zip_file:
        # 1. Add root files
        root_files = ['module.json', 'README.md', 'LICENSE'] # Add LICENSE if it exists
        for file in root_files:
            if os.path.exists(file):
                zip_file.write(file)
            elif file != 'LICENSE': # Don't warn for license if not present
                print(f"Warning: {file} is missing.")

        # 2. Add folders
        for folder in folders:
            add_folder_to_zip(zip_file, folder)

    print(f"Zip file '{zip_filename}' created successfully.")

def main():
    try:
        module_id, module_version = read_module_info()
        print(f"Packaging {module_id} v{module_version}...")
        
        create_dist_folder()
        create_zip(module_id, module_version, selected_folders)
        
        print("Done!")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    main()